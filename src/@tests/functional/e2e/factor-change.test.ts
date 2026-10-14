// deno-lint-ignore-file no-await-in-loop
import { assert, assertEquals } from 'jsr:@std/assert@0.224'
import { generateTOTP, generateTOTPSecret } from '@zanix/auth'

import { assertOk, assertRefused, e2eIgnore, type Iam, startIam } from '../../support/e2e.ts'
import { stepUpTestKeys } from '../../unit/helpers/step-up.ts'
import { factorChangeToken } from '../../unit/helpers/factor-change.ts'
import { STEP_UP_TOKEN_HEADER } from 'utils/shared-enums.ts'

/**
 * Changing or removing a second factor on a real server over HTTP. An attacker holding only an
 * access token (a stolen token, an XSS) can start an enrollment but cannot finish one, cannot
 * remove the factor, cannot change the delivery channel or the password, and cannot obtain a
 * step-up token for the account, because every one of those needs a proof only the current factor
 * gives.
 */
const keyEnv = () => ({
  JWK_PRI: btoa(stepUpTestKeys.privateKey),
  JWK_PUB: btoa(stepUpTestKeys.publicKey),
})

/** Unix time in seconds, `offset` seconds from now: each use of a code takes its own step. */
const stepAt = (offset: number) => Math.floor(Date.now() / 1000) + offset

const withProof = (proof: string) => ({ [STEP_UP_TOKEN_HEADER]: proof })

/** An account with an authenticator app, enrolled the way a first enrollment is (the email proof is
 * minted with the server's key, since a throw-away server cannot deliver mail). */
async function totpAccount(iam: Iam, email: string) {
  const { authId } = await iam.register(iam.admin.accessToken, email)
  const { accessToken: token } = await iam.login(email)
  const { secret } = assertOk(await iam.call('GET', '/login/totp/enroll', { token })) as {
    secret: string
  }
  assertOk(
    await iam.call('POST', '/login/totp/confirm', {
      token,
      headers: withProof(await factorChangeToken(authId, 'totp-confirm')),
      body: { secret, code: await generateTOTP(secret, { time: stepAt(-30) }) },
    }),
  )
  return { authId, token, secret }
}

const REQUIRED = 'FACTOR_CHANGE_PROOF_REQUIRED'
const INVALID = 'FACTOR_CHANGE_PROOF_INVALID'

Deno.test({
  name:
    'e2e: with only an access token nobody can replace the second factor or mint a step-up token',
  ignore: e2eIgnore,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const iam = await startIam({ env: keyEnv() })
    try {
      const victim = await totpAccount(iam, 'victim@iam-test.invalid')
      const { authId, token, secret } = victim
      const attackerSecret = generateTOTPSecret()

      await t.step('every change is refused without a proof and says what to confirm', async () => {
        const changes: [string, string, unknown, string][] = [
          [
            'POST',
            '/login/totp/confirm',
            { secret: attackerSecret, code: '123456' },
            'totp-confirm',
          ],
          ['DELETE', '/login/totp', undefined, 'totp-disable'],
          [
            'POST',
            '/login/phone/confirm',
            { phone: '+15551234567', code: '123456' },
            'phone-confirm',
          ],
          ['DELETE', '/login/phone', undefined, 'phone-disable'],
          ['POST', '/login/otp-notifier', { notifier: 'sms' }, 'otp-notifier'],
          [
            'POST',
            '/pwd/change',
            { currentPassword: 'x', newPassword: 'New1pass' },
            'password-change',
          ],
          ['POST', '/pwd/add', { newPassword: 'New1pass' }, 'password-add'],
          ['DELETE', '/pwd/remove', undefined, 'password-remove'],
        ]
        for (const [method, path, body, bind] of changes) {
          const reply = await iam.call(method, path, { token, body })
          assertRefused(reply, 403, REQUIRED)
          assertEquals(reply.body.meta?.stepUp, { purpose: 'factor-change', bind }, path)
        }
      })

      await t.step(
        'a stolen enrollment cannot be finished: the attacker secret is never stored',
        async () => {
          // Starting an enrollment is allowed; it stores nothing the attacker chose.
          assertOk(await iam.call('GET', '/login/totp/enroll', { token }))
          const reply = await iam.call('POST', '/login/totp/confirm', {
            token,
            body: { secret: attackerSecret, code: await generateTOTP(attackerSecret) },
          })
          assertRefused(reply, 403, REQUIRED)
        },
      )

      await t.step(
        'the account still answers to its own authenticator and not to the attacker one',
        async () => {
          const request = await iam.call('POST', '/step-up/request', {
            token,
            body: { purpose: 'factor-change' },
          })
          assertEquals(assertOk(request).method, 'totp')
          assertRefused(
            await iam.call('POST', '/step-up/verify', {
              token,
              body: { purpose: 'factor-change', code: await generateTOTP(attackerSecret) },
            }),
            403,
          )
        },
      )

      await t.step('a proof for another purpose, account or operation is refused', async () => {
        const wrong = [
          await factorChangeToken(authId, 'totp-disable', { purpose: 'wallet-transfer' }),
          await factorChangeToken(authId, 'totp-disable', { subject: 'someone-else' }),
          await factorChangeToken(authId, 'phone-disable'),
          'not-a-token',
        ]
        for (const proof of wrong) {
          assertRefused(
            await iam.call('DELETE', '/login/totp', { token, headers: withProof(proof) }),
            403,
            INVALID,
          )
        }
      })

      await t.step(
        'a body secret that enroll did not issue is refused even with a valid proof, and the proof is kept',
        async () => {
          const proof = await factorChangeToken(authId, 'totp-confirm')
          assertOk(await iam.call('GET', '/login/totp/enroll', { token }))
          const reply = await iam.call('POST', '/login/totp/confirm', {
            token,
            headers: withProof(proof),
            body: { secret: attackerSecret, code: await generateTOTP(attackerSecret) },
          })
          assertRefused(reply, 403)
          // The account's own authenticator is untouched.
          const check = await iam.call('POST', '/step-up/verify', {
            token,
            body: {
              purpose: 'factor-change',
              code: await generateTOTP(secret, { time: stepAt(30) }),
            },
          })
          assertOk(check)
        },
      )

      await t.step(
        'the owner changes the factor with the real flow: request, verify, one use of the token',
        async () => {
          assertOk(
            await iam.call('POST', '/step-up/request', {
              token,
              body: { purpose: 'factor-change' },
            }),
          )
          const { stepUpToken } = assertOk(
            await iam.call('POST', '/step-up/verify', {
              token,
              body: {
                purpose: 'factor-change',
                code: await generateTOTP(secret),
                bind: 'totp-disable',
              },
            }),
          ) as { stepUpToken: string }

          assertOk(
            await iam.call('DELETE', '/login/totp', { token, headers: withProof(stepUpToken) }),
          )
          // Spent: it proves nothing a second time.
          assertRefused(
            await iam.call('DELETE', '/login/totp', { token, headers: withProof(stepUpToken) }),
            403,
            INVALID,
          )
        },
      )
    } finally {
      await iam.stop()
    }
  },
})

Deno.test({
  name: 'e2e: an account with no second factor enrolls one with the first-enrollment proof, once',
  ignore: e2eIgnore,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const iam = await startIam({ env: keyEnv() })
    try {
      const { authId } = await iam.register(iam.admin.accessToken, 'fresh@iam-test.invalid')
      const token = await iam.signToken({ sub: authId, type: 'user', aud: [] })
      const { secret } = assertOk(await iam.call('GET', '/login/totp/enroll', { token })) as {
        secret: string
      }
      const proof = await factorChangeToken(authId, 'totp-confirm')
      const code = await generateTOTP(secret)

      assertRefused(
        await iam.call('POST', '/login/totp/confirm', { token, body: { code } }),
        403,
        REQUIRED,
      )
      assertOk(
        await iam.call('POST', '/login/totp/confirm', {
          token,
          headers: withProof(proof),
          body: { code },
        }),
      )
      // The account now answers step-up with the app, and the enrollment proof is spent.
      const reply = await iam.call('POST', '/step-up/request', {
        token,
        body: { purpose: 'factor-change' },
      })
      assertEquals(assertOk(reply).method, 'totp')
      // Replaying the proof changes nothing: it is refused (403), or there is no enrollment left
      // to confirm (400).
      const replay = await iam.call('POST', '/login/totp/confirm', {
        token,
        headers: withProof(proof),
        body: { code },
      })
      assert([400, 403].includes(replay.status), `replay answered ${replay.status}`)
    } finally {
      await iam.stop()
    }
  },
})
