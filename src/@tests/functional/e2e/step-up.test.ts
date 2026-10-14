// deno-lint-ignore-file no-await-in-loop
import { assert, assertEquals } from 'jsr:@std/assert@0.224'
import { decodeJWT, generateTOTP } from '@zanix/auth'

import { assertOk, assertRefused, e2eIgnore, type Iam, startIam } from '../../support/e2e.ts'
import { stepUpTestKeys, verifyStepUpToken } from '../../unit/helpers/step-up.ts'
import { factorChangeToken } from '../../unit/helpers/factor-change.ts'
import { STEP_UP_TOKEN_HEADER } from 'utils/shared-enums.ts'

/**
 * Step-up on a real server over HTTP: an account that enrolled an authenticator app asks for a
 * step-up, answers the code, and gets a token a service can verify with the public key. The
 * one-time-code factor needs a delivered message, which a throw-away server has no channel for;
 * it is covered with the real OTP functions in `unit/server/interactors/step-up.service.test.ts`.
 */
/** Unix time in seconds, `offset` seconds from now. */
const stepAt = (offset: number) => Math.floor(Date.now() / 1000) + offset

const keyEnv = () => ({
  JWK_PRI: btoa(stepUpTestKeys.privateKey),
  JWK_PUB: btoa(stepUpTestKeys.publicKey),
})

/**
 * Registers an account and enrolls an authenticator app for it. The access token is the server's
 * own login (`signedIn`), or one signed with the server's key for the account (`signedIn: false`),
 * for a server whose anonymous sign-in limit is too low to spend on it.
 */
async function totpAccount(iam: Iam, email: string, signedIn = true) {
  const { authId } = await iam.register(iam.admin.accessToken, email)
  const accessToken = signedIn
    ? (await iam.login(email)).accessToken
    : await iam.signToken({ sub: authId, type: 'user', aud: [] })
  const session = { accessToken }
  const { secret } = assertOk(
    await iam.call('GET', '/login/totp/enroll', { token: accessToken }),
  ) as { secret: string }
  // Changing the second factor needs a `factor-change` proof. A first enrollment is proven by the
  // account's email code, which a throw-away server cannot deliver, so the proof is minted with
  // the server's own key. The enrollment code is one step back, leaving the current step's code
  // to the step-up checks that follow (a code is accepted once).
  const proof = await factorChangeToken(authId, 'totp-confirm')
  assertOk(
    await iam.call('POST', '/login/totp/confirm', {
      token: accessToken,
      headers: { [STEP_UP_TOKEN_HEADER]: proof },
      body: { secret, code: await generateTOTP(secret, { time: stepAt(-30) }) },
    }),
  )
  return { authId, session, secret }
}

Deno.test({
  name:
    'e2e: step-up with an authenticator app issues a verifiable token and refuses everything else',
  ignore: e2eIgnore,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const iam = await startIam({ env: keyEnv() })
    try {
      const { authId, session, secret } = await totpAccount(iam, 'step.up@iam-test.invalid')
      const token = session.accessToken
      const request = (body: unknown, bearer: string | undefined = token) =>
        iam.call('POST', '/step-up/request', { token: bearer, body })
      const verify = (body: unknown, bearer: string | undefined = token) =>
        iam.call('POST', '/step-up/verify', { token: bearer, body })

      let stepUpToken = ''
      await t.step(
        'request answers the factor of the account settings: totp, nothing sent',
        async () => {
          const reply = assertOk(await request({ purpose: 'wallet-transfer' }))
          assertEquals(reply, { method: 'totp', expiresInSeconds: 300 })
        },
      )

      await t.step(
        'verify with the authenticator code answers a token bound to the session account',
        async () => {
          const reply = assertOk(
            await verify({
              purpose: 'wallet-transfer',
              code: await generateTOTP(secret),
              bind: 'tx-42',
            }),
          )
          stepUpToken = reply.stepUpToken
          const claims = await verifyStepUpToken(stepUpToken, {
            purpose: 'wallet-transfer',
            subject: authId,
            bind: 'tx-42',
          })
          assertEquals(claims.method, 'totp')
          assertEquals(claims.typ, 'step-up')
          assertEquals(claims.aud, 'iam:step-up')
          assertEquals(claims.exp, reply.expiresAt)
          assertEquals((claims.exp ?? 0) - (claims.iat ?? 0), 300)
          assertEquals(decodeJWT(stepUpToken).header.alg, 'RS256')
        },
      )

      await t.step(
        'the account in the token is the session one, whatever the body says',
        async () => {
          const reply = assertOk(
            await verify({
              purpose: 'wallet-transfer',
              code: await generateTOTP(secret, { time: stepAt(30) }),
              sub: iam.admin.claims.sub,
              userId: iam.admin.claims.sub,
            }),
          )
          assertEquals(decodeJWT(reply.stepUpToken).payload.sub, authId)
          assertEquals('bind' in decodeJWT(reply.stepUpToken).payload, false)
        },
      )

      await t.step('the step-up token is not an access token on any route', async () => {
        for (const [method, path] of [['GET', '/login/methods'], ['GET', '/users']] as const) {
          assertRefused(await iam.call(method, path, { token: stepUpToken }), 403)
        }
        assertRefused(
          await verify({ purpose: 'wallet-transfer', code: '000000' }, stepUpToken),
          403,
        )
      })

      await t.step('an access token is not a step-up token', async () => {
        let message = ''
        try {
          await verifyStepUpToken(token, { purpose: 'wallet-transfer', subject: authId })
        } catch (error) {
          message = (error as Error).message
        }
        assert(message.length > 0, 'the access token must fail the step-up verification')
      })

      await t.step(
        'failures: wrong code 403, no token 401, bad purpose 400, same 403 body for every cause',
        async () => {
          const wrong = await verify({ purpose: 'wallet-transfer', code: '000000' })
          const noOtp = await verify({ purpose: 'another-purpose', code: '000000' })
          assertRefused(wrong, 403)
          assertRefused(noOtp, 403)
          assertEquals(wrong.body.message, noOtp.body.message)
          assertEquals(wrong.body.code, noOtp.body.code)

          assertRefused(await request({ purpose: 'wallet-transfer' }, ''), 401)
          assertRefused(await verify({ purpose: 'wallet-transfer', code: '1' }, ''), 401)
          assertRefused(await request({ purpose: 'Wallet Transfer' }), 400)
          assertRefused(await request({}), 400)
          assertRefused(await verify({ purpose: 'wallet-transfer' }), 400)
          assertRefused(await verify({ purpose: 'wallet-transfer', code: '1', bind: 'tx-ñ' }), 400)
        },
      )

      await t.step('a deactivated account gets the same 403 as a wrong code', async () => {
        const closed = await totpAccount(iam, 'closed@iam-test.invalid')
        assertOk(
          await iam.call('PATCH', '/users/deactivate', { token: closed.session.accessToken }),
        )
        const reply = await iam.call('POST', '/step-up/verify', {
          token: closed.session.accessToken,
          body: { purpose: 'wallet-transfer', code: await generateTOTP(closed.secret) },
        })
        assertRefused(reply, 403)
      })
    } finally {
      await iam.stop()
    }
  },
})

Deno.test({
  name: 'e2e: step-up requests and attempts are limited per account',
  ignore: e2eIgnore,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const iam = await startIam({
      env: {
        ...keyEnv(),
        FREE_RATELIMIT: '3',
        CRITICAL_RATELIMIT: '1',
        RATE_LIMIT_WINDOW_SECONDS: '60',
      },
    })
    try {
      const { session, secret } = await totpAccount(iam, 'limited@iam-test.invalid', false)
      const token = session.accessToken

      assertOk(await iam.call('POST', '/step-up/request', { token, body: { purpose: 'wallet' } }))
      const limitedRequest = await iam.call('POST', '/step-up/request', {
        token,
        body: { purpose: 'wallet' },
      })
      assertRefused(limitedRequest, 429)
      assert(limitedRequest.headers.has('retry-after'))

      for (let attempt = 0; attempt < 3; attempt++) {
        assertRefused(
          await iam.call('POST', '/step-up/verify', {
            token,
            body: { purpose: 'wallet', code: '000000' },
          }),
          403,
        )
      }
      // The window is spent: even the right code is a 429, not a 403 and not a token.
      assertRefused(
        await iam.call('POST', '/step-up/verify', {
          token,
          body: { purpose: 'wallet', code: await generateTOTP(secret) },
        }),
        429,
      )
    } finally {
      await iam.stop()
    }
  },
})
