// deno-lint-ignore-file no-await-in-loop no-explicit-any
import { assert, assertEquals } from 'jsr:@std/assert@0.224'
import { createAppToken, createServiceAssertion, generateTOTP } from '@zanix/auth'
import { generateRSAKeys } from '@zanix/helpers'

import {
  assertOk,
  assertRefused,
  e2eIgnore,
  FIRST_ADMIN,
  type Iam,
  startIam,
  TEST_PASSWORD,
} from '../../support/e2e.ts'
import { stepUpTestKeys, withStepUpKeys } from '../../unit/helpers/step-up.ts'
import { factorChangeToken } from '../../unit/helpers/factor-change.ts'
import { STEP_UP_TOKEN_HEADER } from 'utils/shared-enums.ts'

/**
 * The service endpoints (`/admin/service/*`) on a real server over HTTP: a service listed in
 * `IAM_TOTP_RESET_SERVICES` exchanges its signed assertion for a token, looks an account up by its
 * exact email and resets its authenticator app on behalf of an operator, audited with the service,
 * the operator and the reason. Users, unlisted services and an empty allowlist are refused.
 */
const SERVICE = 'ops-console'
const OTHER_SERVICE = 'notifications'
const serviceKeys = await generateRSAKeys()
const otherKeys = await generateRSAKeys()

const baseEnv = () => ({
  JWK_PRI: btoa(stepUpTestKeys.privateKey),
  JWK_PUB: btoa(stepUpTestKeys.publicKey),
  [`JWK_PUB_${SERVICE}`]: btoa(serviceKeys.publicKey),
  [`JWK_PUB_${OTHER_SERVICE}`]: btoa(otherKeys.publicKey),
})

/**
 * An access token of the first administrator that carries its permissions. The token the harness
 * signs in with can be issued before the seeders granted the role (`aud` empty) on a loaded machine,
 * so it signs in again until the audience is there.
 */
const adminTokens = new WeakMap<Iam, string>()
async function adminToken(iam: Iam): Promise<string> {
  const known = adminTokens.get(iam)
  if (known) return known
  const begin = Date.now()
  for (;;) {
    const session = await iam.login(FIRST_ADMIN.email, FIRST_ADMIN.password)
    if (session.claims.aud.length) {
      adminTokens.set(iam, session.accessToken)
      return session.accessToken
    }
    if (Date.now() - begin > 30_000) throw new Error('the first administrator has no permissions')
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

const stepAt = (offset: number) => Math.floor(Date.now() / 1000) + offset

async function enroll(iam: Iam, email: string) {
  const { authId } = await iam.register(await adminToken(iam), email)
  const { accessToken: token } = await iam.login(email)
  const { secret } = assertOk(await iam.call('GET', '/login/totp/enroll', { token })) as {
    secret: string
  }
  const confirmed = assertOk(
    await iam.call('POST', '/login/totp/confirm', {
      token,
      headers: { [STEP_UP_TOKEN_HEADER]: await factorChangeToken(authId, 'totp-confirm') },
      body: { secret, code: await generateTOTP(secret, { time: stepAt(-30) }) },
    }),
  ) as { backupCodes: string[] }
  return { authId, token, backupCodes: confirmed.backupCodes }
}

/** The headers of a service call: a token exchanged for the assertion of `serviceId`. */
async function serviceHeaders(iam: Iam, serviceId = SERVICE, privateKey = serviceKeys.privateKey) {
  const assertion = await createServiceAssertion({
    serviceId,
    privateKey: btoa(privateKey),
  })
  const reply = await iam.call('POST', '/admin/service/token', { body: { assertion } })
  const { accessToken } = assertOk(reply) as { accessToken: string }
  return { 'x-znx-authorization': `Bearer ${accessToken}` }
}

Deno.test({
  name:
    'e2e: a listed service looks an account up and resets its authenticator app for an operator, audited',
  ignore: e2eIgnore,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const iam = await startIam({ env: { ...baseEnv(), IAM_TOTP_RESET_SERVICES: ` ${SERVICE}, ` } })
    try {
      const email = 'service.lost@iam-test.invalid'
      const victim = await enroll(iam, email)
      const headers = await serviceHeaders(iam)
      const lookup = (email: string, h: Record<string, string> = headers) =>
        iam.call('POST', '/admin/service/accounts/lookup', { headers: h, body: { email } })
      const reset = (body: unknown, h: Record<string, string> = headers) =>
        iam.call('POST', '/admin/service/totp/reset', { headers: h, body })

      await t.step('lookup answers the ids and the TOTP state, never the email', async () => {
        const found = assertOk(await lookup(email)) as Record<string, unknown>
        assertEquals(Object.keys(found).sort(), [
          'authId',
          'backupCodesRemaining',
          'hasTotp',
          'status',
          'userId',
        ])
        assertEquals([found.authId, found.hasTotp, found.status], [victim.authId, true, 'ACTIVE'])
        assertEquals(found.backupCodesRemaining, victim.backupCodes.length)
        assert(!JSON.stringify(found).includes('iam-test.invalid'))
      })

      await t.step('lookup of an unknown address is a 404 with the usual code', async () => {
        assertRefused(await lookup('nobody@iam-test.invalid'), 404, 'USER_NOT_FOUND')
      })

      await t.step(
        'the exchange refuses a service that is not listed, and a bad assertion',
        async () => {
          const unlisted = await createServiceAssertion({
            serviceId: OTHER_SERVICE,
            privateKey: btoa(otherKeys.privateKey),
          })
          assertRefused(
            await iam.call('POST', '/admin/service/token', { body: { assertion: unlisted } }),
            403,
            'SERVICE_NOT_AUTHORIZED',
          )
          // Listed, but signed with a key that is not the one registered.
          const forged = await createServiceAssertion({
            serviceId: SERVICE,
            privateKey: btoa(otherKeys.privateKey),
          })
          const reply = await iam.call('POST', '/admin/service/token', {
            body: { assertion: forged },
          })
          assert(
            reply.status === 400 || reply.status === 401 || reply.status === 403,
            `${reply.status}`,
          )
        },
      )

      await t.step("a user token is refused with 403, even the first administrator's", async () => {
        const user = { authorization: `Bearer ${await adminToken(iam)}` }
        assertRefused(await lookup(email, user), 403, 'SERVICE_CREDENTIAL_REQUIRED')
        assertRefused(
          await reset(
            { authId: victim.authId, reason: 'Lost phone', operator: { id: 'op-1' } },
            user,
          ),
          403,
          'SERVICE_CREDENTIAL_REQUIRED',
        )
        assertRefused(
          await iam.call('GET', '/admin/service/totp/resets', { headers: user }),
          403,
          'SERVICE_CREDENTIAL_REQUIRED',
        )
        assertEquals(
          (await iam.call('POST', '/admin/service/accounts/lookup', {
            body: { email },
          })).status,
          401,
        )
      })

      await t.step('a valid service token of a service that is not listed is a 403', async () => {
        const token = await withStepUpKeys(() =>
          createAppToken({ type: 'api', subject: OTHER_SERVICE, expiration: 60 })
        )
        const other = { 'x-znx-authorization': `Bearer ${token}` }
        assertRefused(await lookup(email, other), 403, 'SERVICE_NOT_AUTHORIZED')
        assertRefused(
          await reset(
            { authId: victim.authId, reason: 'Lost phone', operator: { id: 'op-1' } },
            other,
          ),
          403,
          'SERVICE_NOT_AUTHORIZED',
        )
        assertEquals(
          ((await iam.call('GET', '/login/methods', { token: victim.token })).body as any)
            .totpEnabled,
          true,
        )
      })

      await t.step('the body is validated: reason, operator and account id', async () => {
        const base = { authId: victim.authId, reason: 'Lost phone', operator: { id: 'op-1' } }
        for (
          const body of [
            { ...base, reason: '' },
            { ...base, reason: '   ' },
            { ...base, reason: 'x'.repeat(201) },
            { ...base, reason: 'bad\u0000' },
            { ...base, operator: undefined },
            { ...base, operator: { id: '' } },
            { ...base, operator: { id: 'has space' } },
            { ...base, operator: 'op-1' },
            { ...base, authId: 'nope' },
          ]
        ) {
          assertEquals((await reset(body)).status, 400, JSON.stringify(body).slice(0, 80))
        }
        assertEquals((await lookup('not-an-email')).status, 400)
      })

      await t.step('an operator id equal to the target is refused', async () => {
        assertRefused(
          await reset({
            authId: victim.authId,
            reason: 'Lost phone',
            operator: { id: victim.authId },
          }),
          403,
          'TOTP_RESET_SELF',
        )
      })

      await t.step(
        'the reset removes the app and the codes; the person signs in without a challenge',
        async () => {
          assertEquals(
            assertOk(
              await reset({
                authId: victim.authId,
                reason: '  Lost phone, identity checked by call  ',
                operator: { id: 'staff-42' },
              }),
            ),
            { response: 'TOTP reset' },
          )
          const account = await iam.db.col('auths').findOne({ _id: iam.db.oid(victim.authId) })
          for (const field of ['totpSecret', 'twoFactorAuthConfig', 'backupCodeHashes']) {
            assertEquals(account[field], undefined, field)
          }
          const found = assertOk(await lookup(email)) as any
          assertEquals([found.hasTotp, found.backupCodesRemaining], [false, 0])
          assert((await iam.login(email, TEST_PASSWORD)).accessToken)
          const old = await iam.call('POST', '/login/totp/callback', {
            body: { email, code: victim.backupCodes[0] },
          })
          assertEquals(old.status, 403)
        },
      )

      await t.step('resetting again is a clear 409', async () => {
        assertRefused(
          await reset({ authId: victim.authId, reason: 'Again', operator: { id: 'staff-42' } }),
          409,
          'TOTP_NOT_ENABLED',
        )
      })

      await t.step('an unknown account is a 404', async () => {
        assertRefused(
          await reset({ authId: 'f'.repeat(24), reason: 'Lost', operator: { id: 'staff-42' } }),
          404,
        )
      })

      await t.step('the audit records the service, the operator id and the reason', async () => {
        const page = assertOk(
          await iam.call('GET', '/admin/service/totp/resets', {
            headers,
            query: { authId: victim.authId },
          }),
        ) as { docs: Record<string, any>[] }
        const ok = page.docs.filter((event) => event.result === 'ok')
        assertEquals(ok.length, 1)
        assertEquals(ok[0].actor, SERVICE)
        assertEquals(ok[0].actorType, 'api')
        assertEquals(ok[0].action, 'totp.reset')
        assertEquals(ok[0].target, { kind: 'account', id: victim.authId })
        assertEquals(ok[0].request, {
          reason: 'Lost phone, identity checked by call',
          operatorId: 'staff-42',
        })
        assert(page.docs.some((event) => event.result === 'conflict'))
        assert(page.docs.some((event) => event.result === 'denied'))
      })
    } finally {
      await iam.stop()
    }
  },
})

Deno.test({
  name: 'e2e: two concurrent service resets of one account: one succeeds, the other is a 409',
  ignore: e2eIgnore,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const iam = await startIam({ env: { ...baseEnv(), IAM_TOTP_RESET_SERVICES: SERVICE } })
    try {
      for (let round = 0; round < 6; round++) {
        const victim = await enroll(iam, `race${round}@iam-test.invalid`)
        const headers = await serviceHeaders(iam)
        const replies = await Promise.all(
          [0, 1].map((n) =>
            iam.call('POST', '/admin/service/totp/reset', {
              headers,
              body: { authId: victim.authId, reason: `race ${n}`, operator: { id: `op-${n}` } },
            })
          ),
        )
        assertEquals(replies.map((r) => r.status).sort(), [200, 409], `round ${round}`)
        const events = await iam.db.col('role_audit_events').find({
          action: 'totp.reset',
          'target.id': victim.authId,
        }).toArray()
        assertEquals(events.filter((e: any) => e.result === 'ok').length, 1)
      }
    } finally {
      await iam.stop()
    }
  },
})

Deno.test({
  name: 'e2e: with IAM_TOTP_RESET_SERVICES unset or empty every service call is refused',
  ignore: e2eIgnore,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    for (const env of [{}, { IAM_TOTP_RESET_SERVICES: '' }] as Record<string, string>[]) {
      const iam = await startIam({ env: { ...baseEnv(), ...env } })
      try {
        await t.step(`allowlist ${JSON.stringify(env)}`, async () => {
          const victim = await enroll(iam, 'closed@iam-test.invalid')
          const assertion = await createServiceAssertion({
            serviceId: SERVICE,
            privateKey: btoa(serviceKeys.privateKey),
          })
          assertRefused(
            await iam.call('POST', '/admin/service/token', { body: { assertion } }),
            403,
            'SERVICE_NOT_AUTHORIZED',
          )
          // Even a genuine service token minted by other means gets nothing.
          const token = await withStepUpKeys(() =>
            createAppToken({ type: 'api', subject: SERVICE, expiration: 60 })
          )
          const headers = { 'x-znx-authorization': `Bearer ${token}` }
          assertRefused(
            await iam.call('POST', '/admin/service/accounts/lookup', {
              headers,
              body: { email: 'closed@iam-test.invalid' },
            }),
            403,
            'SERVICE_NOT_AUTHORIZED',
          )
          assertRefused(
            await iam.call('POST', '/admin/service/totp/reset', {
              headers,
              body: { authId: victim.authId, reason: 'Lost', operator: { id: 'op' } },
            }),
            403,
            'SERVICE_NOT_AUTHORIZED',
          )
          assertEquals(
            ((await iam.call('GET', '/login/methods', { token: victim.token })).body as any)
              .totpEnabled,
            true,
          )
        })
      } finally {
        await iam.stop()
      }
    }
  },
})
