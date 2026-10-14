// deno-lint-ignore-file no-await-in-loop no-explicit-any
import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@0.224'
import { generateTOTP } from '@zanix/auth'

import {
  assertOk,
  assertRefused,
  e2eIgnore,
  type Iam,
  startIam,
  TEST_PASSWORD,
} from '../../support/e2e.ts'
import { stepUpTestKeys } from '../../unit/helpers/step-up.ts'
import { factorChangeToken } from '../../unit/helpers/factor-change.ts'
import { STEP_UP_TOKEN_HEADER } from 'utils/shared-enums.ts'

/**
 * TOTP backup codes and the operator reset on a real server over HTTP: the codes are shown once at
 * enrollment, stand in for an authenticator code at sign-in and at step-up, are spent once, are
 * replaced as a set, and an operator with `totp-reset` removes the authenticator app of an account
 * that lost it, recorded in the audit trail.
 */
const keyEnv = () => ({
  JWK_PRI: btoa(stepUpTestKeys.privateKey),
  JWK_PUB: btoa(stepUpTestKeys.publicKey),
})

const stepAt = (offset: number) => Math.floor(Date.now() / 1000) + offset
const withProof = (proof: string) => ({ [STEP_UP_TOKEN_HEADER]: proof })
const FORMAT = /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/

async function enroll(iam: Iam, email: string) {
  const { authId } = await iam.register(iam.admin.accessToken, email)
  const { accessToken: token } = await iam.login(email)
  const { secret } = assertOk(await iam.call('GET', '/login/totp/enroll', { token })) as {
    secret: string
  }
  const confirmed = assertOk(
    await iam.call('POST', '/login/totp/confirm', {
      token,
      headers: withProof(await factorChangeToken(authId, 'totp-confirm')),
      body: { secret, code: await generateTOTP(secret, { time: stepAt(-30) }) },
    }),
  ) as { response: string; backupCodes: string[] }
  return { authId, token, secret, backupCodes: confirmed.backupCodes, confirmed }
}

const methods = async (iam: Iam, token: string) =>
  assertOk(await iam.call('GET', '/login/methods', { token }))

Deno.test({
  name:
    'e2e: backup codes are issued once, accepted at sign-in and step-up, spent once and replaced as a set',
  ignore: e2eIgnore,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const iam = await startIam({ env: keyEnv() })
    try {
      const email = 'codes@iam-test.invalid'
      const { authId, token, backupCodes, confirmed } = await enroll(iam, email)

      await t.step('enrollment returns 10 formatted codes, once', () => {
        assertEquals(confirmed.response, 'TOTP enabled')
        assertEquals(backupCodes.length, 10)
        assertEquals(new Set(backupCodes).size, 10)
        for (const code of backupCodes) assert(FORMAT.test(code), code)
      })

      await t.step('the methods summary counts them and never lists them', async () => {
        const summary = await methods(iam, token)
        assertEquals([summary.totpEnabled, summary.backupCodesRemaining], [true, 10])
        for (const code of backupCodes) {
          assert(!JSON.stringify(summary).includes(code.replace('-', '')))
        }
      })

      await t.step('the stored digests are not the codes', async () => {
        const account = await iam.db.col('auths').findOne({ _id: iam.db.oid(authId) })
        const stored = JSON.stringify(account)
        for (const code of backupCodes) {
          assert(!stored.includes(code) && !stored.includes(code.replace('-', '')))
        }
        assertEquals(account.backupCodeHashes.length, 10)
      })

      await t.step('a backup code completes the sign-in challenge, once', async () => {
        const challenge = assertOk(
          await iam.call('POST', '/login/login', { body: { email, password: TEST_PASSWORD } }),
        )
        assertEquals(challenge.method, 'totp')
        const typed = backupCodes[0].toLowerCase().replace('-', ' ')
        const session = assertOk(
          await iam.call('POST', '/login/totp/callback', { body: { email, code: typed } }),
        )
        assert(session.accessToken)
        assertEquals((await methods(iam, session.accessToken)).backupCodesRemaining, 9)

        // The same code again is refused exactly like a wrong authenticator code.
        const reused = await iam.call('POST', '/login/totp/callback', {
          body: { email, code: backupCodes[0] },
        })
        const wrong = await iam.call('POST', '/login/totp/callback', {
          body: { email, code: '000000' },
        })
        assertEquals([reused.status, reused.body.code], [wrong.status, wrong.body.code])
        assertEquals(reused.body.message, wrong.body.message)
        assertEquals(reused.status, 403)
      })

      await t.step(
        'a backup code is a step-up factor, bound to the purpose and operation',
        async () => {
          const stepUp = assertOk(
            await iam.call('POST', '/step-up/verify', {
              token,
              body: {
                purpose: 'factor-change',
                code: backupCodes[1],
                bind: 'totp-backup-codes',
              },
            }),
          ) as { stepUpToken: string }
          // The proof regenerates the set.
          const fresh = assertOk(
            await iam.call('POST', '/login/totp/backup-codes', {
              token,
              headers: withProof(stepUp.stepUpToken),
            }),
          ) as { backupCodes: string[] }
          assertEquals(fresh.backupCodes.length, 10)
          for (const code of fresh.backupCodes) assert(FORMAT.test(code))
          for (const old of backupCodes) assert(!fresh.backupCodes.includes(old))
          assertEquals((await methods(iam, token)).backupCodesRemaining, 10)

          // The proof is single use, and the old codes are gone.
          assertRefused(
            await iam.call('POST', '/login/totp/backup-codes', {
              token,
              headers: withProof(stepUp.stepUpToken),
            }),
            403,
            'FACTOR_CHANGE_PROOF_INVALID',
          )
          const oldCode = await iam.call('POST', '/login/totp/callback', {
            body: { email, code: backupCodes[2] },
          })
          assertEquals(oldCode.status, 403)
          assertOk(
            await iam.call('POST', '/login/totp/callback', {
              body: { email, code: fresh.backupCodes[0] },
            }),
          )
        },
      )

      await t.step('regenerating needs a proof', async () => {
        assertRefused(
          await iam.call('POST', '/login/totp/backup-codes', { token }),
          403,
          'FACTOR_CHANGE_PROOF_REQUIRED',
        )
      })

      await t.step(
        'disabling TOTP clears the codes; enrolling again issues a new set',
        async () => {
          assertOk(
            await iam.call('DELETE', '/login/totp', {
              token,
              headers: withProof(await factorChangeToken(authId, 'totp-disable')),
            }),
          )
          assertEquals((await methods(iam, token)).backupCodesRemaining, 0)
          const account = await iam.db.col('auths').findOne({ _id: iam.db.oid(authId) })
          assertEquals(account.backupCodeHashes, undefined)
          // Without an authenticator app there is nothing to back up.
          assertRefused(
            await iam.call('POST', '/login/totp/backup-codes', {
              token,
              headers: withProof(await factorChangeToken(authId, 'totp-backup-codes')),
            }),
            409,
            'TOTP_NOT_ENABLED',
          )
        },
      )
    } finally {
      await iam.stop()
    }
  },
})

Deno.test({
  name:
    'e2e: an operator with totp-reset removes the authenticator app of an account that lost it, audited',
  ignore: e2eIgnore,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const iam = await startIam({ env: keyEnv() })
    try {
      const email = 'lost@iam-test.invalid'
      const victim = await enroll(iam, email)
      const operatorId = iam.admin.claims.sub
      const reset = (token: string, body: unknown) =>
        iam.call('POST', '/admin/totp/reset', { token, body })

      await t.step('an account without totp-reset is denied', async () => {
        const other = await iam.register(iam.admin.accessToken, 'plain@iam-test.invalid')
        const { accessToken } = await iam.login('plain@iam-test.invalid')
        assertRefused(
          await reset(accessToken, { authId: victim.authId, reason: 'Lost phone' }),
          403,
        )
        assertNotEquals(other.authId, victim.authId)
        assertEquals((await methods(iam, victim.token)).totpEnabled, true)
      })

      await t.step('the reason is required, trimmed and bounded', async () => {
        for (const reason of ['', '   ', 'x'.repeat(201)]) {
          const reply = await reset(iam.admin.accessToken, { authId: victim.authId, reason })
          assertEquals(reply.status, 400, JSON.stringify(reason).slice(0, 20))
        }
        assertEquals((await methods(iam, victim.token)).totpEnabled, true)
      })

      await t.step('an operator cannot reset their own account', async () => {
        assertRefused(
          await reset(iam.admin.accessToken, { authId: operatorId, reason: 'Lost phone' }),
          403,
          'TOTP_RESET_SELF',
        )
      })

      await t.step(
        'the reset removes the app and the codes; the person signs in without a challenge',
        async () => {
          assertEquals(
            assertOk(
              await reset(iam.admin.accessToken, {
                authId: victim.authId,
                reason: '  Lost phone, identity checked by call  ',
              }),
            ),
            { response: 'TOTP reset' },
          )
          const summary = await methods(iam, victim.token)
          assertEquals([summary.totpEnabled, summary.backupCodesRemaining], [false, 0])
          const account = await iam.db.col('auths').findOne({ _id: iam.db.oid(victim.authId) })
          for (const field of ['totpSecret', 'twoFactorAuthConfig', 'backupCodeHashes']) {
            assertEquals(account[field], undefined, field)
          }
          const session = await iam.login(email)
          assert(session.accessToken)
          // A backup code from before the reset no longer signs anyone in.
          const old = await iam.call('POST', '/login/totp/callback', {
            body: { email, code: victim.backupCodes[0] },
          })
          assertEquals(old.status, 403)
        },
      )

      await t.step('resetting again is a clear 409, not a 500', async () => {
        assertRefused(
          await reset(iam.admin.accessToken, { authId: victim.authId, reason: 'Again' }),
          409,
          'TOTP_NOT_ENABLED',
        )
      })

      await t.step('the reset is in the audit trail with operator, target and reason', async () => {
        const page = assertOk(
          await iam.call('GET', '/admin/totp/resets', { token: iam.admin.accessToken }),
        ) as { docs: Record<string, any>[]; total: number }
        const ok = page.docs.filter((event) => event.result === 'ok')
        assertEquals(ok.length, 1)
        assertEquals(ok[0].actor, operatorId)
        assertEquals(ok[0].action, 'totp.reset')
        assertEquals(ok[0].target, { kind: 'account', id: victim.authId })
        assertEquals(ok[0].request, { reason: 'Lost phone, identity checked by call' })
        // Newest first; the conflicting attempt is recorded too.
        assertEquals(page.docs[0].result, 'conflict')

        const filtered = assertOk(
          await iam.call('GET', '/admin/totp/resets', {
            token: iam.admin.accessToken,
            query: { authId: victim.authId },
          }),
        ) as { docs: unknown[] }
        assert(filtered.docs.length >= 1)
        const general = assertOk(
          await iam.call('GET', '/audit', {
            token: iam.admin.accessToken,
            query: { action: 'totp.reset' },
          }),
        ) as { docs: unknown[] }
        assertEquals(general.docs.length, page.docs.length)

        // The reader needs totp-reset: a plain account is denied.
        const plain = await iam.login('plain@iam-test.invalid').catch(() => undefined)
        if (plain) {
          assertRefused(
            await iam.call('GET', '/admin/totp/resets', { token: plain.accessToken }),
            403,
          )
        }
      })
    } finally {
      await iam.stop()
    }
  },
})
