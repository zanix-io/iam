import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@0.224'

import { assertOk, e2eIgnore, startIam } from '../../support/e2e.ts'

/**
 * The email proof on a real server: an account an administrator created has proven nothing, so
 * its sessions carry `email_verified: false` and `GET /login/methods` says so; once the account
 * records a proof, every new session, every refresh and the methods summary reflect it. The
 * one-time-code and OAuth2 sign-ins that record the proof need a delivered message or a provider,
 * which a throw-away server has no channel for; they are covered in
 * `unit/server/interactors/email-verified.service.test.ts`.
 */
Deno.test({
  name:
    'e2e: email_verified starts false, and a recorded proof reaches sessions, refreshes and methods',
  ignore: e2eIgnore,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const iam = await startIam()
    try {
      const email = 'verified.e2e@iam-test.invalid'
      const { authId } = await iam.register(iam.admin.accessToken, email)

      let session = await iam.login(email)
      await t.step('an account that has proven nothing signs in with email_verified false', () => {
        assertEquals(session.claims.email_verified, false)
      })

      await t.step('the methods summary says unverified and carries no timestamp', async () => {
        const methods = assertOk(
          await iam.call('GET', '/login/methods', { token: session.accessToken }),
        )
        assertEquals(methods.emailVerified, false)
        assertFalse('emailVerifiedAt' in methods)
      })

      const provenAt = new Date('2026-05-06T07:08:09.000Z')
      await iam.db.col('auths').updateOne(
        { _id: iam.db.oid(authId) },
        { $set: { emailVerifiedAt: provenAt } },
      )

      await t.step('a refresh reflects the recorded proof', async () => {
        const refreshed = await iam.refresh(session)
        assertEquals(refreshed.claims.email_verified, true)
        assertEquals(refreshed.claims.sub, session.claims.sub)
        assert(Array.isArray(refreshed.claims.aud))
        session = refreshed
      })

      await t.step('a new sign-in carries email_verified true', async () => {
        assertEquals((await iam.login(email)).claims.email_verified, true)
      })

      await t.step('the methods summary reports the proof with an ISO timestamp', async () => {
        const methods = assertOk(
          await iam.call('GET', '/login/methods', { token: session.accessToken }),
        )
        assertEquals(methods.emailVerified, true)
        assertEquals(methods.emailVerifiedAt, provenAt.toISOString())
      })
    } finally {
      await iam.stop()
    }
  },
})
