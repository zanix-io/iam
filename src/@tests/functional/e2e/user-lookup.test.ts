// deno-lint-ignore-file no-await-in-loop
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@0.224'

import { IAM_ERROR_CODES, RBAC_PERMISSIONS } from 'utils/constants.ts'
import {
  assertOk,
  assertRefused,
  e2eIgnore,
  FIRST_ADMIN,
  startIam,
  toolbox,
} from '../../support/e2e.ts'

/**
 * `GET /users/lookup?email=`: the exact lookup of one person by the email of their account, for an
 * administrator who must pick someone without knowing their `authId`. Everything runs on a real
 * server: the answer, what it never contains, the 404 that does not say why, the validation, the
 * three refusals (401/403/429), the audit trail and the routes it must not disturb.
 */
const P = RBAC_PERMISSIONS
const DOMAIN = 'lookup-e2e.invalid'
const MARIA = `maria.lopez@${DOMAIN}`
const KEYS = ['authId', 'firstName', 'lastName', 'roleIds', 'status', 'userId']

/** Every string value in `value`, however deep. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings)
  return []
}

Deno.test({
  name: 'e2e: GET /users/lookup finds one person by their exact email and says nothing else',
  ignore: e2eIgnore,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const iam = await startIam()
    const tools = toolbox(iam)
    const admin = iam.admin.accessToken
    const lookup = (email: string | undefined, token: string | null = admin) =>
      iam.call('GET', '/users/lookup', {
        token: token ?? undefined,
        query: email === undefined ? undefined : { email },
      })
    try {
      const maria = await iam.register(admin, MARIA, { firstName: 'Maria', lastName: 'Lopez' })
      const roleId = await tools.createRole('lookup-holder', [P.userRead])
      assertOk(
        await iam.call('POST', '/roles/assign', {
          token: admin,
          body: { authId: maria.authId, roleId },
        }),
      )

      await t.step(
        'success: exactly the projection, and the email nowhere in the answer',
        async () => {
          const reply = await lookup(MARIA)
          const body = assertOk(reply)
          assertEquals(Object.keys(body).sort(), KEYS)
          assertEquals(body, {
            authId: maria.authId,
            userId: maria.userId,
            firstName: 'Maria',
            lastName: 'Lopez',
            status: 'ACTIVE',
            roleIds: [roleId],
          })
          const everything = JSON.stringify([...strings(body), ...reply.headers.values()])
          assertFalse(everything.includes(DOMAIN), 'the email is in no value of the reply')
          assertFalse(everything.toLowerCase().includes('maria.lopez'))
          // The same person the by-id route knows.
          const byId = assertOk(await iam.call('GET', `/users/${maria.userId}`, { token: admin }))
          assertEquals([byId.authId, byId.roleIds], [maria.authId, [roleId]])
        },
      )

      await t.step(
        'capitals and surrounding spaces are normalized; nothing partial matches',
        async () => {
          assertEquals(assertOk(await lookup(`  ${MARIA.toUpperCase()}  `)).authId, maria.authId)
          assertEquals(assertOk(await lookup(` ${MARIA}`)).authId, maria.authId)
          for (const partial of [`maria.lopez@${DOMAIN.slice(0, -1)}`, `aria.lopez@${DOMAIN}`]) {
            assertRefused(await lookup(partial), 404, IAM_ERROR_CODES.userNotFound)
          }
        },
      )

      await t.step(
        'an INACTIVE person is found with its status; DELETED, no profile and no account are one and the same 404',
        async () => {
          const inactive = await iam.register(admin, `inactive@${DOMAIN}`)
          assertOk(
            await iam.call('PATCH', `/users/${inactive.userId}`, {
              token: admin,
              body: { status: 'INACTIVE' },
            }),
          )
          const found = assertOk(await lookup(`inactive@${DOMAIN}`))
          assertEquals([found.authId, found.status], [inactive.authId, 'INACTIVE'])

          const deleted = await iam.register(admin, `deleted@${DOMAIN}`)
          assertOk(
            await iam.call('PATCH', `/users/${deleted.userId}`, {
              token: admin,
              body: { status: 'DELETED' },
            }),
          )
          const orphan = await iam.register(admin, `orphan@${DOMAIN}`)
          await iam.db.col('auths').updateOne(
            { _id: iam.db.oid(orphan.authId) },
            { $unset: { userId: '' } },
          )

          // The error `id` and `contextId` are generated per request; everything else must be equal.
          const stable = ({ id: _id, contextId: _contextId, ...rest }: Record<string, unknown>) =>
            rest
          const misses = []
          for (const email of [`nobody@${DOMAIN}`, `deleted@${DOMAIN}`, `orphan@${DOMAIN}`]) {
            const reply = await lookup(email)
            assertRefused(reply, 404, IAM_ERROR_CODES.userNotFound)
            misses.push(reply)
          }
          for (const miss of misses) {
            assertEquals(
              stable(miss.body),
              stable(misses[0].body),
              'the same body for every no-result',
            )
            assertFalse(JSON.stringify(miss.body).includes(DOMAIN))
          }
        },
      )

      await t.step(
        '400 for an email that is not one, empty, missing or too long; the route is not read as an id',
        async () => {
          for (
            const email of [
              'not-an-email',
              '',
              'a@@b.co',
              `${'a'.repeat(250)}@${DOMAIN}`,
              `${MARIA},${MARIA}`,
            ]
          ) {
            const reply = await lookup(email)
            assertEquals(reply.status, 400, JSON.stringify(email.slice(0, 20)))
          }
          const missing = await lookup(undefined)
          assertEquals(missing.status, 400)
          assert(
            JSON.stringify(missing.body).includes('email'),
            'the validation names the email, so /users/lookup was not routed to /users/:id',
          )
        },
      )

      await t.step(
        '401 without a token; 403 with an account that holds neither user-read nor user-write',
        async () => {
          assertEquals((await lookup(MARIA, null)).status, 401)
          await iam.register(admin, `plain@${DOMAIN}`)
          const plain = (await iam.login(`plain@${DOMAIN}`)).accessToken
          assertEquals((await lookup(MARIA, plain)).status, 403)
          // A service credential on the service header is not a user session at all.
          const apiToken = await iam.signToken({ sub: 'service', type: 'api', aud: ['*'] })
          const reply = await iam.call('GET', '/users/lookup', {
            query: { email: MARIA },
            headers: { 'x-znx-authorization': `Bearer ${apiToken}` },
          })
          assertEquals(reply.status, 401)
        },
      )

      await t.step(
        'user-read is enough; a service credential presented as a user is ACTOR_NOT_ACCOUNT',
        async () => {
          const reader = (await iam.login(MARIA)).accessToken
          assertEquals(assertOk(await lookup(MARIA, reader)).authId, maria.authId)
          const apiToken = await iam.signToken({ sub: 'service', type: 'api', aud: ['*'] })
          assertRefused(await lookup(MARIA, apiToken), 403, IAM_ERROR_CODES.actorNotAccount)
        },
      )

      await t.step(
        'an operator whose role was taken away stops looking people up at once',
        async () => {
          const reader = await iam.login(MARIA)
          assertEquals((await lookup(MARIA, reader.accessToken)).status, 200)
          assertOk(
            await iam.call('POST', '/roles/remove', {
              token: admin,
              body: { authId: maria.authId, roleIds: [roleId] },
            }),
          )
          // The token still says user-read; the database no longer does.
          assertRefused(
            await lookup(MARIA, reader.accessToken),
            403,
            IAM_ERROR_CODES.actorLacksPermission,
          )
        },
      )

      await t.step(
        'every lookup is on the audit trail, never with the email or its digest',
        async () => {
          const events = await iam.db.col('role_audit_events').find({ action: 'users.lookup' })
            .toArray()
          assert(events.length >= 10, `lookup events: ${events.length}`)
          const results = new Set(events.map((event: { result: string }) => event.result))
          for (const result of ['ok', 'not-found', 'denied']) assert(results.has(result), result)
          const hit = events.find((event: { result: string; actor: string }) =>
            event.result === 'ok' && event.actor === iam.admin.claims.sub
          )
          assertEquals(hit.actorType, 'user')
          assertEquals(hit.target.kind, 'user')
          assert(typeof hit.target.id === 'string' && hit.target.id.length > 0)
          const miss = events.find((event: { result: string }) => event.result === 'not-found')
          assertEquals([miss.reason, miss.target.id], [IAM_ERROR_CODES.userNotFound, undefined])

          const trail = JSON.stringify(events).toLowerCase()
          assertFalse(trail.includes(DOMAIN), 'no email in the trail')
          assertFalse(trail.includes('maria.lopez'))
          const digest = await iam.db.col('auths').findOne({ _id: iam.db.oid(maria.authId) })
          assertFalse(trail.includes(String(digest.emailKeyId).toLowerCase()), 'no digest')
          // And the trail is readable through the API with the same shape.
          const listed = assertOk(
            await iam.call('GET', '/audit', { token: admin, query: { action: 'users.lookup' } }),
          )
          assert(listed.docs.length > 0)
          assertFalse(JSON.stringify(listed).toLowerCase().includes(DOMAIN))
        },
      )

      await t.step('GET /users/search and GET /users/:id keep their shape', async () => {
        const search = assertOk(
          await iam.call('GET', '/users/search', { token: admin, query: { query: 'Lopez' } }),
        )
        const entry = search.docs.find((doc: { authId?: string }) => doc.authId === maria.authId)
        assertEquals(entry.id, maria.userId)
        assertEquals(entry.firstName, 'Maria')
        assertEquals(entry.roleIds, [])
        const byId = assertOk(await iam.call('GET', `/users/${maria.userId}`, { token: admin }))
        assertEquals([byId.id, byId.authId, byId.status], [maria.userId, maria.authId, 'ACTIVE'])
        assertEquals(
          (await iam.call('GET', `/users/${'0'.repeat(24)}`, { token: admin })).status,
          404,
        )
      })

      await t.step('the first administrator can be found too', async () => {
        assertEquals(assertOk(await lookup(FIRST_ADMIN.email)).authId, iam.admin.claims.sub)
      })
    } finally {
      await iam.stop()
    }
  },
})

Deno.test({
  name: 'e2e: the lookup is limited per operator, apart from every other route, and answers 429',
  ignore: e2eIgnore,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const LIMIT = 3
    const iam = await startIam({
      env: { ADMIN_LOOKUP_RATELIMIT: String(LIMIT), ADMIN_LOOKUP_RATELIMIT_WINDOW_SECONDS: '60' },
    })
    const admin = iam.admin.accessToken
    const lookup = (email: string, token = admin) =>
      iam.call('GET', '/users/lookup', { token, query: { email } })
    try {
      const statuses: number[] = []
      for (let n = 0; n < LIMIT + 2; n++) {
        statuses.push((await lookup(`nobody${n}@${DOMAIN}`)).status)
      }
      assertEquals(statuses, [404, 404, 404, 429, 429], 'misses and hits both count')

      const limited = await lookup(`nobody@${DOMAIN}`)
      assertEquals(limited.status, 429)
      assertEquals(limited.headers.has('retry-after'), true)
      assertFalse(JSON.stringify(limited.body).includes(DOMAIN))

      // A new login of the same operator shares the bucket.
      const fresh = await iam.login(FIRST_ADMIN.email, FIRST_ADMIN.password)
      assertEquals((await lookup(FIRST_ADMIN.email, fresh.accessToken)).status, 429)

      // Other routes (reads and mutations) are untouched by this bucket.
      assertOk(await iam.call('GET', '/users/search', { token: admin }))
      await iam.register(admin, `other@${DOMAIN}`)

      // Another operator has a bucket of their own.
      const role = await iam.db.col('roles').findOne({ code: 'superadmin' })
      const second = await iam.register(admin, `second@${DOMAIN}`)
      await iam.db.col('auths').updateOne(
        { _id: iam.db.oid(second.authId) },
        { $set: { roleIds: [role._id] } },
      )
      const token = (await iam.login(`second@${DOMAIN}`)).accessToken
      assertEquals((await lookup(`second@${DOMAIN}`, token)).status, 200)
    } finally {
      await iam.stop()
    }
  },
})
