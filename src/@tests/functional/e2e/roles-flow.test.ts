// deno-lint-ignore-file no-await-in-loop no-explicit-any
import { assert, assertEquals } from 'jsr:@std/assert@0.224'

import { RBAC_PERMISSIONS } from 'utils/constants.ts'
import {
  assertOk,
  assertRefused,
  decodeClaims,
  e2eIgnore,
  startIam,
  SUPERADMIN_ROLE_ID,
  TEST_PASSWORD,
  toolbox,
} from '../../support/e2e.ts'

/**
 * The complete role-administration flow of iam against a REAL server and a REAL MongoDB: boot and
 * seed, roles and permissions, accounts with several roles, the security rules (grant only what you
 * hold, an administrator remains, the caller is read from the database) and the audit trail, all
 * through HTTP with tokens issued by iam's own login. Run it with
 * `IAM_TEST_MONGO_URI=mongodb://127.0.0.1:27017 deno test -A --frozen src/@tests/functional/e2e/`.
 */

const P = RBAC_PERMISSIONS

Deno.test({
  name: 'e2e: roles, accounts, security rules and audit trail over HTTP',
  ignore: e2eIgnore,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const iam = await startIam()
    const admin = iam.admin.accessToken
    const tools = toolbox(iam)
    try {
      await t.step(
        'boot and seed: superadmin is a system role, audit-read is seeded, the first administrator signs in with *',
        async () => {
          assertEquals(iam.admin.claims.aud, ['*'])
          const permissions = assertOk(
            await iam.call('GET', '/permissions', { token: admin, query: { limit: 100 } }),
          ).docs.map((doc: { code: string }) => doc.code)
          for (const code of ['*', ...Object.values(P)]) assert(permissions.includes(code), code)
          const superadmin = assertOk(
            await iam.call('GET', `/roles/${SUPERADMIN_ROLE_ID}`, { token: admin }),
          )
          assertEquals([superadmin.code, superadmin.isSystem], ['superadmin', true])
          assertEquals(superadmin.holderCount, 1)
          const mine = await iam.call('GET', `/roles/accounts/${iam.admin.claims.sub}`, {
            token: admin,
          })
          assertEquals(mine.body.roleIds, [SUPERADMIN_ROLE_ID])
        },
      )

      await t.step('roles: a valid one is created, an invalid shape is a 400', async () => {
        await tools.createRole('viewer', [P.roleRead])
        const bad = await iam.call('POST', '/roles', {
          token: admin,
          body: { name: 'Bad‮name', code: 'Bad Code', description: '', permissions: ['nope'] },
        })
        assertEquals(bad.status, 400)
        // Too many permissions for one role.
        const many = await iam.call('POST', '/roles', {
          token: admin,
          body: {
            name: 'Many',
            code: 'many',
            description: 'many',
            permissions: Array(201).fill('693000000000000000000100'),
          },
        })
        assertEquals(many.status, 400)
      })

      await t.step(
        'roles: editing with the version read applies, a stale version is ROLE_VERSION_CONFLICT',
        async () => {
          const id = await tools.roleIdByCode('viewer')
          const read = assertOk(await iam.call('GET', `/roles/${id}`, { token: admin }))
          assertOk(
            await iam.call('PATCH', `/roles/${id}`, {
              token: admin,
              body: {
                description: 'Read only viewer',
                updatedAt: new Date(read.updatedAt).toISOString(),
              },
            }),
          )
          const stale = await iam.call('PATCH', `/roles/${id}`, {
            token: admin,
            body: { description: 'Stale write', updatedAt: new Date(read.updatedAt).toISOString() },
          })
          assertRefused(stale, 409, 'ROLE_VERSION_CONFLICT')
          // Without a version the last edit wins.
          assertOk(
            await iam.call('PATCH', `/roles/${id}`, {
              token: admin,
              body: { description: 'Last wins' },
            }),
          )
          assertEquals(
            assertOk(await iam.call('GET', `/roles/${id}`, { token: admin })).description,
            'Last wins',
          )
        },
      )

      await t.step(
        'roles: one nobody holds is deleted, one with holders is ROLE_HAS_HOLDERS with the count',
        async () => {
          const unused = await tools.createRole('unused', [P.roleRead])
          assertOk(await iam.call('DELETE', `/roles/${unused}`, { token: admin }))
          assertRefused(await iam.call('GET', `/roles/${unused}`, { token: admin }), 404)

          const held = await tools.createRole('held', [P.roleRead])
          const a = await iam.register(admin, 'held.one@iam-test.invalid')
          const b = await iam.register(admin, 'held.two@iam-test.invalid')
          for (const person of [a, b]) {
            assertOk(
              await iam.call('POST', '/roles/add', {
                token: admin,
                body: { authId: person.authId, roleIds: [held] },
              }),
            )
          }
          const refused = await iam.call('DELETE', `/roles/${held}`, { token: admin })
          const body = assertRefused(refused, 409, 'ROLE_HAS_HOLDERS')
          assertEquals(body.meta.holderCount, 2)
          assertEquals([...body.meta.holderIds].sort(), [a.authId, b.authId].sort())
          // The holders can be listed, with names and no contact data.
          const holders = assertOk(
            await iam.call('GET', `/roles/${held}/holders`, { token: admin }),
          )
          assertEquals(holders.total, 2)
          assertEquals(Object.keys(holders.docs[0]).sort(), [
            'authId',
            'firstName',
            'lastName',
            'status',
            'userId',
          ])
          // Once they lose it, it can go.
          for (const person of [a, b]) {
            assertOk(
              await iam.call('POST', '/roles/remove', {
                token: admin,
                body: { authId: person.authId, roleIds: [held] },
              }),
            )
          }
          assertOk(await iam.call('DELETE', `/roles/${held}`, { token: admin }))
        },
      )

      await t.step(
        'system roles: superadmin cannot be edited or deleted, not even by *, and only * creates one',
        async () => {
          for (
            const reply of [
              await iam.call('PATCH', `/roles/${SUPERADMIN_ROLE_ID}`, {
                token: admin,
                body: { name: 'Renamed' },
              }),
              await iam.call('DELETE', `/roles/${SUPERADMIN_ROLE_ID}`, { token: admin }),
            ]
          ) assertRefused(reply, 403, 'ROLE_IS_SYSTEM')

          // A role-write holder who is not * cannot create a system role.
          await tools.createPermission('shop:buy')
          const lightRole = await tools.createRole('light-admin', [
            P.roleRead,
            P.roleWrite,
            P.userRead,
            P.userWrite,
            P.permissionRead,
            P.permissionWrite,
            'shop:buy',
          ])
          const light = await iam.register(admin, 'light.admin@iam-test.invalid')
          assertOk(
            await iam.call('POST', '/roles/add', {
              token: admin,
              body: { authId: light.authId, roleIds: [lightRole] },
            }),
          )
          const lightToken = (await iam.login('light.admin@iam-test.invalid')).accessToken
          const body = {
            name: 'Core',
            code: 'core',
            description: 'Core role',
            permissions: [],
            isSystem: true,
          }
          const refused = assertRefused(
            await iam.call('POST', '/roles', { token: lightToken, body }),
            403,
            'ROLE_GRANT_EXCEEDS_SCOPE',
          )
          assertEquals(refused.meta.missing, ['*'])
          // The first administrator can, and the new role is then untouchable.
          assertOk(await iam.call('POST', '/roles', { token: admin, body }))
          const core = await tools.roleIdByCode('core')
          assertRefused(
            await iam.call('DELETE', `/roles/${core}`, { token: admin }),
            403,
            'ROLE_IS_SYSTEM',
          )
        },
      )

      // Shared fixtures for the next steps.
      await tools.createPermission('shop:sell')
      const sellerRole = await tools.createRole('seller', ['shop:sell'])
      const buyerRole = await tools.createRole('buyer', ['shop:buy'])
      const lightToken = (await iam.login('light.admin@iam-test.invalid')).accessToken

      await t.step(
        'accounts with several roles: assign, add, remove, PUT and the reads',
        async () => {
          const person = await iam.register(admin, 'multi@iam-test.invalid')
          const id = person.authId
          const call = (method: string, path: string, body?: unknown) =>
            iam.call(method, path, { token: admin, body })

          assertOk(await call('POST', '/roles/assign', { authId: id, roleId: buyerRole }))
          assertEquals(await tools.rolesOf(id), [buyerRole])
          // `add` keeps what the account holds, in order.
          assertOk(await call('POST', '/roles/add', { authId: id, roleIds: [sellerRole] }))
          assertEquals(await tools.rolesOf(id), [buyerRole, sellerRole])
          // Repeating it changes nothing.
          assertOk(await call('POST', '/roles/add', { authId: id, roleIds: [sellerRole] }))
          assertEquals(await tools.rolesOf(id), [buyerRole, sellerRole])
          assertOk(await call('POST', '/roles/remove', { authId: id, roleIds: [buyerRole] }))
          assertEquals(await tools.rolesOf(id), [sellerRole])
          assertOk(await call('PUT', `/roles/accounts/${id}`, { roleIds: [buyerRole, sellerRole] }))
          assertEquals(await tools.rolesOf(id), [buyerRole, sellerRole])

          // The people list carries the account and its roles.
          const found = assertOk(
            await iam.call('GET', '/users/search', {
              token: admin,
              query: { limit: 100 },
            }),
          )
          const entry = found.docs.find((doc: { authId?: string }) => doc.authId === id)
          assertEquals(entry.roleIds, [buyerRole, sellerRole])

          // The effective permissions are the union, each with where it comes from.
          const effective = assertOk(
            await iam.call('GET', `/roles/accounts/${id}/permissions`, { token: admin }),
          )
          assertEquals(
            [...effective.permissions].sort((x, y) => x.code.localeCompare(y.code)),
            [
              { code: 'shop:buy', roles: [buyerRole] },
              { code: 'shop:sell', roles: [sellerRole] },
            ],
          )

          // The token of an account with several roles carries the UNION, at login and at refresh.
          const session = await iam.login('multi@iam-test.invalid')
          assertEquals([...session.claims.aud].sort(), ['shop:buy', 'shop:sell'])
          assertOk(await call('POST', '/roles/remove', { authId: id, roleIds: [sellerRole] }))
          const refreshed = await iam.refresh(session)
          assertEquals(refreshed.claims.aud, ['shop:buy'], 'a role change reaches the next refresh')
          // One role keeps working as before; none gives an empty list.
          assertOk(await call('PUT', `/roles/accounts/${id}`, { roleIds: [] }))
          assertEquals((await iam.refresh(refreshed)).claims.aud, [])

          // Unknown role and unknown account.
          assertRefused(
            await call('POST', '/roles/add', { authId: id, roleIds: ['693000000000000000009999'] }),
            404,
          )
          assertRefused(
            await call('POST', '/roles/add', {
              authId: '693000000000000000009999',
              roleIds: [buyerRole],
            }),
            404,
          )
          // The request shape: empty and malformed lists.
          assertEquals((await call('POST', '/roles/add', { authId: id, roleIds: [] })).status, 400)
          assertEquals((await call('PUT', `/roles/accounts/${id}`, { roleIds: ['x'] })).status, 400)
        },
      )

      await t.step('nobody changes their own roles', async () => {
        const reply = await iam.call('POST', '/roles/add', {
          token: admin,
          body: { authId: iam.admin.claims.sub, roleIds: [buyerRole] },
        })
        assertRefused(reply, 403, 'ROLE_SELF_CHANGE')
      })

      await t.step(
        'grant only what you hold: a role-write holder cannot hand out what it lacks, with every operation',
        async () => {
          const target = await iam.register(admin, 'target@iam-test.invalid')
          const call = (method: string, path: string, body?: unknown) =>
            iam.call(method, path, { token: lightToken, body })
          const missing = (reply: Awaited<ReturnType<typeof call>>) =>
            assertRefused(reply, 403, 'ROLE_GRANT_EXCEEDS_SCOPE').meta.missing

          // shop:sell is not held by the light administrator (it holds shop:buy).
          assertEquals(
            missing(
              await call('POST', '/roles/assign', { authId: target.authId, roleId: sellerRole }),
            ),
            ['shop:sell'],
          )
          assertEquals(
            missing(
              await call('POST', '/roles/add', { authId: target.authId, roleIds: [sellerRole] }),
            ),
            ['shop:sell'],
          )
          assertEquals(
            missing(
              await call('PUT', `/roles/accounts/${target.authId}`, { roleIds: [sellerRole] }),
            ),
            ['shop:sell'],
          )
          // Creating a role with a permission it lacks, or with *.
          const sellPermission = await tools.permissionId('shop:sell')
          const wildcard = await tools.permissionId('*')
          assertEquals(
            missing(
              await call('POST', '/roles', {
                name: 'Sell more',
                code: 'sell-more',
                description: 'x',
                permissions: [sellPermission],
              }),
            ),
            ['shop:sell'],
          )
          assertEquals(
            missing(
              await call('POST', '/roles', {
                name: 'Wild',
                code: 'wild',
                description: 'x',
                permissions: [wildcard],
              }),
            ),
            ['*'],
          )
          // Editing a role so that it gains a permission it lacks, or loses one it lacks (degrading).
          assertEquals(
            missing(
              await call('PATCH', `/roles/${buyerRole}`, {
                permissions: [await tools.permissionId('shop:buy'), sellPermission],
              }),
            ),
            ['shop:sell'],
          )
          assertEquals(missing(await call('PATCH', `/roles/${sellerRole}`, { permissions: [] })), [
            'shop:sell',
          ])
          assertEquals(missing(await call('DELETE', `/roles/${sellerRole}`)), ['shop:sell'])
          // Turning a permission on or off needs holding it; its description does not.
          const sell = await tools.permissionId('shop:sell')
          assertEquals(missing(await call('PATCH', `/permissions/${sell}`, { isActive: false })), [
            'shop:sell',
          ])
          assertOk(await call('PATCH', `/permissions/${sell}`, { description: 'Sell things' }))
        },
      )

      await t.step(
        'only * grants *, and the person who holds it signs in with the wildcard',
        async () => {
          const wildcard = await tools.permissionId('*')
          const wildRole = await tools.createRole('wild-role', ['*'])
          const person = await iam.register(admin, 'wild@iam-test.invalid')
          // The light administrator cannot hand the wildcard out, however it asks.
          assertEquals(
            assertRefused(
              await iam.call('POST', '/roles/add', {
                token: lightToken,
                body: { authId: person.authId, roleIds: [wildRole] },
              }),
              403,
              'ROLE_GRANT_EXCEEDS_SCOPE',
            ).meta.missing,
            ['*'],
          )
          assertOk(
            await iam.call('POST', '/roles/add', {
              token: admin,
              body: { authId: person.authId, roleIds: [wildRole] },
            }),
          )
          assertEquals((await iam.login('wild@iam-test.invalid')).claims.aud, ['*'])
          void wildcard
        },
      )

      await t.step(
        'user-write cannot block a person it does not cover, and can block one it does',
        async () => {
          const covered = await iam.register(admin, 'covered@iam-test.invalid')
          const uncovered = await iam.register(admin, 'uncovered@iam-test.invalid')
          for (
            const [person, role] of [[covered, buyerRole], [uncovered, sellerRole]] as const
          ) {
            assertOk(
              await iam.call('POST', '/roles/add', {
                token: admin,
                body: { authId: person.authId, roleIds: [role] },
              }),
            )
          }
          // The light administrator holds shop:buy but not shop:sell.
          const refused = await iam.call('PATCH', `/users/${uncovered.userId}`, {
            token: lightToken,
            body: { status: 'INACTIVE' },
          })
          assertEquals(
            assertRefused(refused, 403, 'ROLE_GRANT_EXCEEDS_SCOPE').meta.missing,
            ['shop:sell'],
          )
          // The refused block left the person able to sign in.
          await iam.login('uncovered@iam-test.invalid')
          assertOk(
            await iam.call('PATCH', `/users/${covered.userId}`, {
              token: lightToken,
              body: { status: 'INACTIVE' },
            }),
          )
          // The blocked person can no longer sign in.
          const blocked = await iam.call('POST', '/login/login', {
            body: { email: 'covered@iam-test.invalid', password: TEST_PASSWORD },
          })
          assertEquals(blocked.status, 403)
        },
      )

      await t.step(
        'the caller is read from the database: a demoted administrator with a live token no longer grants',
        async () => {
          const demoted = await iam.register(admin, 'demoted@iam-test.invalid')
          const adminRole = await tools.roleIdByCode('light-admin')
          assertOk(
            await iam.call('POST', '/roles/add', {
              token: admin,
              body: { authId: demoted.authId, roleIds: [adminRole] },
            }),
          )
          const target = await iam.register(admin, 'granted@iam-test.invalid')
          const token = (await iam.login('demoted@iam-test.invalid')).accessToken
          const add = () =>
            iam.call('POST', '/roles/add', {
              token,
              body: { authId: target.authId, roleIds: [buyerRole] },
            })
          assertOk(await add())
          assertOk(
            await iam.call('POST', '/roles/remove', {
              token: admin,
              body: { authId: target.authId, roleIds: [buyerRole] },
            }),
          )
          // Demote it behind the token's back: its roles change, its access token does not.
          const writerOnly = await tools.createRole('writer-only', [P.roleRead, P.roleWrite])
          await iam.db.col('auths').updateOne(
            { _id: iam.db.oid(demoted.authId) },
            { $set: { roleIds: [iam.db.oid(writerOnly)] } },
          )
          assertEquals(
            decodeClaims(token).aud.includes(P.roleWrite),
            true,
            'the token still says so',
          )
          // Still an administrator of roles, but no longer one who holds shop:buy: it cannot grant it.
          assertEquals(
            assertRefused(await add(), 403, 'ROLE_GRANT_EXCEEDS_SCOPE').meta.missing,
            ['shop:buy'],
          )

          // Demoted all the way: it holds nothing, so even what grants nothing is refused.
          await iam.db.col('auths').updateOne(
            { _id: iam.db.oid(demoted.authId) },
            { $set: { roleIds: [] } },
          )
          const bare = await tools.createRole('bare', [])
          const victim = await tools.createRole('victim', [])
          const permission = await tools.permissionId('shop:buy')
          const refusals: [string, string, unknown, string][] = [
            ['POST', '/roles/add', { authId: target.authId, roleIds: [buyerRole] }, P.roleWrite],
            ['POST', '/roles', {
              name: 'Empty',
              code: 'empty',
              description: 'Empty',
              permissions: [],
            }, P.roleWrite],
            ['PATCH', `/roles/${bare}`, { description: 'Renamed by a demoted admin' }, P.roleWrite],
            ['DELETE', `/roles/${victim}`, undefined, P.roleWrite],
            [
              'POST',
              '/permissions',
              { code: 'ghost:made', name: 'Ghost', description: 'Ghost' },
              P.permissionWrite,
            ],
            [
              'PATCH',
              `/permissions/${permission}`,
              { description: 'Changed by a demoted admin' },
              P.permissionWrite,
            ],
            ['PATCH', `/users/${target.userId}`, { firstName: 'Changed' }, P.userWrite],
            ['POST', '/users/register', {
              email: 'demoted.made@iam-test.invalid',
              password: 'Test-Passw0rd-123!',
            }, P.userWrite],
          ]
          for (const [method, path, body, required] of refusals) {
            const reply = await iam.call(method, path, { token, body })
            assertRefused(reply, 403, 'ACTOR_LACKS_PERMISSION')
            assertEquals(reply.body.meta.required, required, `${method} ${path}`)
          }
          // Nothing of that happened.
          assertEquals(await tools.rolesOf(target.authId), [])
          assertEquals(await iam.db.col('roles').countDocuments({ code: 'empty' }), 0)
          assertEquals(
            (assertOk(await iam.call('GET', `/roles/${bare}`, { token: admin }))).description,
            'Role bare',
          )
          assertOk(await iam.call('GET', `/roles/${victim}`, { token: admin }))
          assertEquals(await iam.db.col('permissions').countDocuments({ code: 'ghost:made' }), 0)
        },
      )

      await t.step(
        'an actor whose account is inactive or deleted is refused, whatever its token says',
        async () => {
          for (const status of ['INACTIVE', 'DELETED']) {
            const email = `actor.${status.toLowerCase()}@iam-test.invalid`
            const actor = await iam.register(admin, email)
            const adminRole = await tools.roleIdByCode('light-admin')
            assertOk(
              await iam.call('POST', '/roles/add', {
                token: admin,
                body: { authId: actor.authId, roleIds: [adminRole] },
              }),
            )
            const token = (await iam.login(email)).accessToken
            await iam.db.col('users').updateOne(
              { _id: iam.db.oid(actor.userId) },
              { $set: { status } },
            )
            const target = await iam.register(
              admin,
              `target.${status.toLowerCase()}@iam-test.invalid`,
            )
            assertRefused(
              await iam.call('POST', '/roles/add', {
                token,
                body: { authId: target.authId, roleIds: [buyerRole] },
              }),
              403,
              'ACTOR_NOT_ACTIVE',
            )
          }
          // An account removed outright is refused the same way.
          const gone = await iam.register(admin, 'actor.gone@iam-test.invalid')
          assertOk(
            await iam.call('POST', '/roles/add', {
              token: admin,
              body: { authId: gone.authId, roleIds: [await tools.roleIdByCode('light-admin')] },
            }),
          )
          const goneToken = (await iam.login('actor.gone@iam-test.invalid')).accessToken
          await iam.db.col('auths').deleteOne({ _id: iam.db.oid(gone.authId) })
          assertRefused(
            await iam.call('POST', '/roles', {
              token: goneToken,
              body: { name: 'Nothing', code: 'nothing', description: 'Nothing', permissions: [] },
            }),
            403,
            'ACTOR_NOT_ACTIVE',
          )
        },
      )

      await t.step(
        'audit trail: every mutation leaves its event, rejected ones too, and nothing sensitive',
        async () => {
          const auditor = await iam.register(admin, 'auditor@iam-test.invalid')
          await tools.createRole('auditor', [P.auditRead])
          assertOk(
            await iam.call('POST', '/roles/add', {
              token: admin,
              body: { authId: auditor.authId, roleIds: [await tools.roleIdByCode('auditor')] },
            }),
          )
          const auditorToken = (await iam.login('auditor@iam-test.invalid')).accessToken

          // Without audit-read: refused by the guard; with it: allowed.
          assertEquals((await iam.call('GET', '/audit', { token: lightToken })).status, 403)
          assertEquals((await iam.call('GET', '/audit')).status, 401)
          const all = assertOk(
            await iam.call('GET', '/audit', { token: auditorToken, query: { limit: 100 } }),
          )
          assert(all.total > 10)

          const events = async (query: Record<string, string | number>) =>
            assertOk(
              await iam.call('GET', '/audit', {
                token: auditorToken,
                query: { limit: 100, ...query },
              }),
            )
              .docs as Record<string, any>[]

          // Rejected by a rule: denied, with the stable code, who tried and on what.
          const denied = await events({ result: 'denied', action: 'roles.add' })
          const grantRefusal = denied.find((e) => e.reason === 'ROLE_GRANT_EXCEEDS_SCOPE') ?? {}
          assertEquals(grantRefusal.target.kind, 'account')
          assert(grantRefusal.actor && grantRefusal.requestId)
          assert((await events({ result: 'denied' })).some((e) => e.reason === 'ROLE_SELF_CHANGE'))
          assert((await events({ result: 'denied' })).some((e) => e.reason === 'ROLE_IS_SYSTEM'))
          assert((await events({ result: 'denied' })).some((e) => e.reason === 'ACTOR_NOT_ACTIVE'))
          // 409s are conflicts, successes are ok, with before/after.
          const conflicts = await events({ result: 'conflict' })
          assert(conflicts.some((e) => e.reason === 'ROLE_VERSION_CONFLICT'))
          assert(conflicts.some((e) => e.reason === 'ROLE_HAS_HOLDERS'))
          const ok = await events({ result: 'ok', action: 'roles.add' })
          assert(ok.some((e) => e.before && e.after))

          // Filters: by actor, by target, by action, by date range; and pagination.
          const adminActor = iam.admin.claims.sub
          assert((await events({ actor: adminActor })).every((e) => e.actor === adminActor))
          const target = grantRefusal.target.id
          assert((await events({ targetId: target })).every((e) => e.target.id === target))
          assert(
            (await events({ action: 'permissions.edit' })).every((e) =>
              e.action === 'permissions.edit'
            ),
          )
          const future = new Date(Date.now() + 86_400_000).toISOString()
          assertEquals((await events({ from: future })).length, 0)
          assert((await events({ to: future })).length > 0)
          const firstPage = assertOk(
            await iam.call('GET', '/audit', { token: auditorToken, query: { limit: 3, page: 1 } }),
          )
          const secondPage = assertOk(
            await iam.call('GET', '/audit', { token: auditorToken, query: { limit: 3, page: 2 } }),
          )
          assertEquals([firstPage.docs.length, secondPage.docs.length], [3, 3])
          assert(firstPage.docs[0].id !== secondPage.docs[0].id)
          // Newest first.
          const stamps = firstPage.docs.map((e: { createdAt: string }) => Date.parse(e.createdAt))
          assertEquals(stamps, [...stamps].sort((a, b) => b - a))
          assertEquals(
            (await iam.call('GET', '/audit', { token: auditorToken, query: { from: 'yesterday' } }))
              .status,
            400,
          )

          // Nothing sensitive: no email, no token, no password anywhere in the trail.
          const dump = JSON.stringify(all.docs) + JSON.stringify(await events({ page: 2 }))
          assert(!dump.includes('@iam-test.invalid'))
          assert(!dump.includes('eyJ'))
          assert(!dump.toLowerCase().includes('password'))

          // Every event is closed: none is left pending once the requests have returned.
          assertEquals(
            await iam.db.col('role_audit_events').countDocuments({ result: 'pending' }),
            0,
          )
        },
      )

      await t.step(
        'an account that stores a role twice can still be changed (no endless ROLE_CONCURRENT_CHANGE)',
        async () => {
          const person = await iam.register(admin, 'twice@iam-test.invalid')
          await iam.db.col('auths').updateOne(
            { _id: iam.db.oid(person.authId) },
            {
              $set: {
                roleIds: [iam.db.oid(buyerRole), iam.db.oid(buyerRole), iam.db.oid(sellerRole)],
              },
            },
          )
          assertEquals(
            assertOk(
              await iam.call('POST', '/roles/remove', {
                token: admin,
                body: { authId: person.authId, roleIds: [sellerRole] },
              }),
            ).roleIds,
            [buyerRole],
          )
          assertOk(
            await iam.call('PUT', `/roles/accounts/${person.authId}`, {
              token: admin,
              body: { roleIds: [sellerRole, buyerRole] },
            }),
          )
          assertEquals(await tools.rolesOf(person.authId), [sellerRole, buyerRole])
        },
      )

      await t.step(
        'every refusal leaves its event, PATCH /users/:id included: not covered, not found, not an active actor',
        async () => {
          const auditor = (await iam.login('auditor@iam-test.invalid')).accessToken
          const events = async (query: Record<string, string | number>) =>
            assertOk(
              await iam.call('GET', '/audit', { token: auditor, query: { limit: 100, ...query } }),
            ).docs as Record<string, any>[]

          // Not found: an edit of a person who does not exist.
          assertRefused(
            await iam.call('PATCH', '/users/693000000000000000009999', {
              token: lightToken,
              body: { firstName: 'Nobody' },
            }),
            404,
          )
          assertRefused(
            await iam.call('PATCH', '/users/693000000000000000009999', {
              token: lightToken,
              body: { status: 'INACTIVE' },
            }),
            404,
          )
          // Not an active actor: the inactive administrator from the earlier step.
          const inactive = await iam.login('actor.inactive@iam-test.invalid').catch(() => undefined)
          assertEquals(inactive, undefined, 'it cannot sign in any more')

          const notFound = await events({ result: 'error' })
          assert(notFound.some((e) => e.action === 'users.edit' && e.reason === 'NOT_FOUND'))
          assert(notFound.some((e) => e.action === 'users.block' && e.reason === 'NOT_FOUND'))
          const denied = await events({ result: 'denied' })
          assert(
            denied.some((e) =>
              e.action === 'users.block' && e.reason === 'ROLE_GRANT_EXCEEDS_SCOPE'
            ),
            'the refused block of a person the caller does not cover is on the trail',
          )
          assert(
            denied.some((e) => e.action === 'users.edit' && e.reason === 'ACTOR_LACKS_PERMISSION'),
            'a demoted administrator editing a person is on the trail',
          )
          // A refusal for a caller that is not an account is on the trail with the credential as actor.
          assert(
            denied.some((e) => e.reason === 'ACTOR_NOT_ACTIVE' || e.reason === 'ACTOR_NOT_ACCOUNT'),
          )
        },
      )

      await t.step(
        'audit details: the created id, the full request of an edit, the allowed sort fields, and orphaned pending events',
        async () => {
          const auditor = (await iam.login('auditor@iam-test.invalid')).accessToken
          const audit = (query: Record<string, string | number>) =>
            iam.call('GET', '/audit', { token: auditor, query })

          // A role created now: its event ends up pointing at it.
          await tools.createRole('audited-new', [P.roleRead])
          const createdId = await tools.roleIdByCode('audited-new')
          const created = assertOk(await audit({ action: 'roles.create', limit: 100 })).docs
          assert(
            created.some((e: { target: { id?: string } }) => e.target.id === createdId),
            'roles.create names the role it created',
          )

          // An edit of permissions keeps name and description of the request apart from before/after.
          const roleId = await tools.roleIdByCode('audited-new')
          assertOk(
            await iam.call('PATCH', `/roles/${roleId}`, {
              token: admin,
              body: {
                description: 'Audited edit',
                permissions: [
                  await tools.permissionId(P.roleRead),
                  await tools.permissionId(P.userRead),
                ],
              },
            }),
          )
          const edited = assertOk(await audit({ targetId: roleId, action: 'roles.edit' })).docs[0]
          assertEquals(edited.request.description, 'Audited edit')
          assertEquals(edited.request.permissions.length, 2)
          assertEquals(edited.before.permissions.length, 1)
          assertEquals(edited.after.permissions.length, 2)

          // sortBy: only the indexed fields.
          assertEquals((await audit({ 'sortBy[createdAt]': 1 })).status, 200)
          assertEquals((await audit({ 'sortBy[actor]': -1, 'sortBy[result]': 1 })).status, 200)
          assertEquals((await audit({ 'sortBy[request]': 1 })).status, 400)
          assertEquals((await audit({ 'sortBy[before]': 1 })).status, 400)
          // A dotted key (`target.id`) is not a sort key the query parser accepts: it is treated as
          // an unknown parameter and ignored, so the default order (newest first) applies. What is
          // never possible is an order outside the closed list: the dotted key is ignored, any other
          // field is a 400.
          const plainOrder = assertOk(await audit({ limit: 100 })).docs.map((e: { id: string }) =>
            e.id
          )
          const dotted = await audit({ 'sortBy[target.id]': 1, limit: 100 })
          assertEquals(dotted.status, 200)
          assertEquals(dotted.body.docs.map((e: { id: string }) => e.id), plainOrder)
          const ascending = assertOk(await audit({ 'sortBy[createdAt]': 1, limit: 5 })).docs
          const stamps = ascending.map((e: { createdAt: string }) => Date.parse(e.createdAt))
          assertEquals(stamps, [...stamps].sort((a, b) => a - b))

          // A pending event whose request died: found by result=pending and an age bound.
          await iam.db.col('role_audit_events').insertOne({
            action: 'roles.add',
            target: { kind: 'account', id: 'orphan' },
            result: 'pending',
            createdAt: new Date(Date.now() - 3_600_000),
            updatedAt: new Date(Date.now() - 3_600_000),
          })
          const fiveMinutesAgo = new Date(Date.now() - 300_000).toISOString()
          const orphans = assertOk(await audit({ result: 'pending', to: fiveMinutesAgo })).docs
          assertEquals(orphans.map((e: { target: { id: string } }) => e.target.id), ['orphan'])
          assertEquals(assertOk(await audit({ result: 'pending' })).docs.length, 1)
        },
      )
    } finally {
      await iam.stop()
    }
  },
})
