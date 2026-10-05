// deno-lint-ignore-file no-await-in-loop
import { assert, assertEquals } from 'jsr:@std/assert@0.224'

import 'server/handlers/roles.handler.ts'
import 'server/handlers/permissions.handler.ts'
import 'server/handlers/users.handler.ts'
import 'server/handlers/audit.handler.ts'
import { restRoutes } from '../../unit/helpers/route-guards.ts'
import { assertOk, e2eIgnore, startIam } from '../../support/e2e.ts'

/**
 * Not one administration endpoint is open. The routes are read from the registry the controllers
 * filled (so a route added tomorrow is covered without touching this file), then every one is
 * called on a real server: without a token it answers 401, with a valid token of an account that
 * holds no permission it answers 403.
 */
const ADMIN_PREFIXES = ['/roles', '/permissions', '/audit', '/users']
/** Self-service routes under `/users`: they need a session and nothing more, by design. */
const SELF_SERVICE = new Set([
  'GET /users',
  'PATCH /users',
  'PATCH /users/deactivate',
  'DELETE /users',
])
const SAMPLE_ID = '693000000000000000009999'

/** What each administration route answers to the `*` service-credential token on `Authorization`. */
const EXPECTED_ON_AUTHORIZATION: Record<string, readonly [number, string | undefined]> = {
  'GET /audit': [200, undefined],
  'GET /permissions': [200, undefined],
  'GET /roles': [200, undefined],
  'GET /users/search': [200, undefined],
  'GET /permissions/:id': [404, undefined],
  'GET /roles/:id': [404, undefined],
  'GET /roles/:id/holders': [404, undefined],
  'GET /roles/accounts/:authId': [404, undefined],
  'GET /roles/accounts/:authId/permissions': [404, undefined],
  'GET /users/:id': [404, undefined],
  'DELETE /roles/:id': [403, 'ACTOR_NOT_ACCOUNT'],
  'PATCH /permissions/:id': [403, 'ACTOR_NOT_ACCOUNT'],
  'PATCH /roles/:id': [403, 'ACTOR_NOT_ACCOUNT'],
  'PATCH /users/:id': [403, 'ACTOR_NOT_ACCOUNT'],
  'POST /permissions': [400, undefined],
  'POST /roles': [400, undefined],
  'POST /roles/add': [400, undefined],
  'POST /roles/assign': [400, undefined],
  'POST /roles/remove': [400, undefined],
  'POST /users/register': [400, undefined],
  'PUT /roles/accounts/:authId': [400, undefined],
}

const sample = (path: string) => path.replace(/:\w+/g, SAMPLE_ID)

Deno.test({
  name:
    'e2e: every administration endpoint refuses a request without a token (401) and without the permission (403)',
  ignore: e2eIgnore,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const routes = Object.entries(restRoutes()).filter(([key]) => {
      const path = key.slice(key.indexOf(' ') + 1)
      return ADMIN_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
    })
    assert(routes.length >= 20, `expected the administration routes, found ${routes.length}`)

    const iam = await startIam()
    try {
      await iam.register(iam.admin.accessToken, 'plain@iam-test.invalid')
      const plain = (await iam.login('plain@iam-test.invalid')).accessToken
      const admin = routes.filter(([key]) => !SELF_SERVICE.has(key))
      const self = routes.filter(([key]) => SELF_SERVICE.has(key))

      await t.step(`${admin.length} administration routes: no token is 401`, async () => {
        for (const [key] of admin) {
          const [method, path] = key.split(' ')
          const reply = await iam.call(method, sample(path), {
            body: method === 'GET' ? undefined : {},
          })
          assertEquals(reply.status, 401, key)
        }
      })

      await t.step(
        `${admin.length} administration routes: a valid token without the permission is 403`,
        async () => {
          for (const [key] of admin) {
            const [method, path] = key.split(' ')
            const reply = await iam.call(method, sample(path), {
              token: plain,
              body: method === 'GET' ? undefined : {},
            })
            assertEquals(reply.status, 403, key)
          }
        },
      )

      await t.step(
        `${admin.length} administration routes: a service credential with * is 401 on X-Znx-Authorization, and gets the exact answer of the table on Authorization`,
        async () => {
          const apiToken = await iam.signToken({
            sub: 'service-credential',
            type: 'api',
            aud: ['*'],
          })
          for (const [key] of admin) {
            const [method, path] = key.split(' ')
            const body = method === 'GET' ? undefined : {}
            // As a service credential is presented to a route that takes one.
            const onServiceHeader = await iam.call(method, sample(path), {
              body,
              headers: { 'x-znx-authorization': `Bearer ${apiToken}` },
            })
            assertEquals(onServiceHeader.status, 401, `${key} via X-Znx-Authorization`)
            // As a user token would be. The token's permissions pass the route guard, so a read
            // answers like it would for any holder of `*` (a list: 200; one record that does not
            // exist: 404), and a mutation either fails its request shape first (400, the body is
            // empty) or reaches the service and is refused as not coming from an account (403).
            const onUserHeader = await iam.call(method, sample(path), { body, token: apiToken })
            assertEquals(
              [onUserHeader.status, onUserHeader.body.code],
              [...(EXPECTED_ON_AUTHORIZATION[key] ?? [-1, undefined])],
              `${key} via Authorization`,
            )
          }
        },
      )

      await t.step(
        'a service credential token presented on Authorization is refused as ACTOR_NOT_ACCOUNT by every mutation, changing nothing',
        async () => {
          // The case this stands for: a token signed with this server's key (HS256, `JWT_KEY`),
          // from iam itself or an app sharing that key, whose subject is a service name and not an
          // iam account id. The guard gives it a `user` session (the type comes from the header);
          // the service must still refuse it, because no account answers to that subject. (A token
          // from another issuer fails the signature check before any of this.)
          const apiToken = await iam.signToken({
            sub: 'service-credential',
            type: 'api',
            aud: ['*'],
          })
          const role = '693000000000000000000201'
          const person = await iam.register(iam.admin.accessToken, 'api.target@iam-test.invalid')
          const calls: [string, string, unknown][] = [
            ['POST', '/roles/assign', { authId: person.authId, roleId: role }],
            ['POST', '/roles/add', { authId: person.authId, roleIds: [role] }],
            ['POST', '/roles/remove', { authId: person.authId, roleIds: [role] }],
            ['PUT', `/roles/accounts/${person.authId}`, { roleIds: [role] }],
            ['POST', '/roles', {
              name: 'Nope',
              code: 'nope',
              description: 'Nope',
              permissions: [],
            }],
            ['PATCH', `/roles/${role}`, { description: 'Nope' }],
            ['DELETE', `/roles/${role}`, undefined],
            ['POST', '/permissions', { code: 'nope:nope', name: 'Nope', description: 'Nope' }],
            ['PATCH', `/permissions/${sample('/:id').slice(1)}`, { name: 'Nope' }],
            ['PATCH', `/users/${person.userId}`, { status: 'INACTIVE' }],
            ['PATCH', `/users/${person.userId}`, { firstName: 'Nope' }],
            ['POST', '/users/register', {
              email: 'api.new@iam-test.invalid',
              password: 'Test-Passw0rd-123!',
            }],
          ]
          for (const [method, path, body] of calls) {
            const reply = await iam.call(method, path, { token: apiToken, body })
            assertEquals(
              [reply.status, reply.body.code],
              [403, 'ACTOR_NOT_ACCOUNT'],
              `${method} ${path}`,
            )
          }
          assertEquals(
            assertOk(
              await iam.call('GET', `/roles/accounts/${person.authId}`, {
                token: iam.admin.accessToken,
              }),
            ).roleIds,
            [],
          )
          const profile = await iam.db.col('users').findOne({ _id: iam.db.oid(person.userId) })
          assertEquals(profile.status, 'ACTIVE')
          assertEquals(await iam.db.col('roles').countDocuments({ code: 'nope' }), 0)
          // The refusals are on the audit trail.
          const denied = await iam.db.col('role_audit_events').countDocuments({
            result: 'denied',
            reason: 'ACTOR_NOT_ACCOUNT',
          })
          assert(denied >= 10, `denied events: ${denied}`)
        },
      )

      await t.step('self-service routes under /users need a session: no token is 401', async () => {
        assertEquals(self.length, SELF_SERVICE.size, 'every self-service route is registered')
        for (const [key] of self) {
          const [method, path] = key.split(' ')
          const reply = await iam.call(method, path, { body: method === 'GET' ? undefined : {} })
          assertEquals(reply.status, 401, key)
        }
        // And a session is enough.
        assertOk(await iam.call('GET', '/users', { token: plain }))
      })
    } finally {
      await iam.stop()
    }
  },
})
