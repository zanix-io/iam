import { assert, assertEquals } from 'jsr:@std/assert@0.224'

import { RBAC_PERMISSIONS } from 'utils/constants.ts'
import { assertOk, assertRefused, e2eIgnore, startIam, toolbox } from '../../support/e2e.ts'

/**
 * "An administrator remains", over HTTP on a real server and database: every path a person can
 * reach that would leave nobody able to manage roles is refused with 409 `LAST_ADMINISTRATOR`, and
 * the refused change leaves nothing behind. The scene is built with one limited administrator
 * (role-write, permission-write, user-write) after the seeded first administrator is made unable
 * to sign in directly in the database, so that the limited one is the only administrator left.
 *
 * A role removal by another administrator is not on this list on purpose: an actor that can change
 * an account's roles holds role-write itself, so it is an administrator that stays; that path
 * only ends in `LAST_ADMINISTRATOR` under a race, which `concurrency.test.ts` covers.
 */
const P = RBAC_PERMISSIONS

Deno.test({
  name: 'e2e: the last administrator cannot be removed, by any path',
  ignore: e2eIgnore,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const iam = await startIam()
    const tools = toolbox(iam)
    try {
      const managerRole = await tools.createRole('manager', [
        P.roleRead,
        P.roleWrite,
        P.permissionRead,
        P.permissionWrite,
        P.userRead,
        P.userWrite,
      ])
      const manager = await iam.register(iam.admin.accessToken, 'manager@iam-test.invalid')
      assertOk(
        await iam.call('POST', '/roles/add', {
          token: iam.admin.accessToken,
          body: { authId: manager.authId, roleIds: [managerRole] },
        }),
      )
      const token = (await iam.login('manager@iam-test.invalid')).accessToken
      // The seeded first administrator can no longer sign in: the manager is the only one left.
      const firstUserId =
        (await iam.db.col('auths').findOne({ _id: iam.db.oid(iam.admin.claims.sub) }))
          .userId
      await iam.db.col('users').updateOne({ _id: firstUserId }, { $set: { status: 'INACTIVE' } })

      const call = (method: string, path: string, body?: unknown) =>
        iam.call(method, path, { token, body })
      const stillStanding = async () => {
        // The manager still signs in and still holds its role.
        await iam.login('manager@iam-test.invalid')
        assertEquals(await tools.rolesOf(manager.authId), [managerRole])
        const profile = await iam.db.col('users').findOne({ _id: iam.db.oid(manager.userId) })
        assertEquals(profile.status, 'ACTIVE')
      }

      await t.step('blocking the only administrator profile through PATCH /users/:id', async () => {
        assertRefused(
          await call('PATCH', `/users/${manager.userId}`, { status: 'INACTIVE' }),
          409,
          'LAST_ADMINISTRATOR',
        )
        assertRefused(
          await call('PATCH', `/users/${manager.userId}`, { status: 'DELETED' }),
          409,
          'LAST_ADMINISTRATOR',
        )
        await stillStanding()
      })

      await t.step('deactivating or deleting the only administrator own account', async () => {
        assertRefused(await call('PATCH', '/users/deactivate'), 409, 'LAST_ADMINISTRATOR')
        assertRefused(await call('DELETE', '/users'), 409, 'LAST_ADMINISTRATOR')
        await stillStanding()
      })

      await t.step('editing the administrator role so that it loses role-write', async () => {
        const withoutRoleWrite = await Promise.all(
          [P.roleRead, P.permissionRead, P.permissionWrite, P.userRead, P.userWrite].map(
            tools.permissionId,
          ),
        )
        assertRefused(
          await call('PATCH', `/roles/${managerRole}`, { permissions: withoutRoleWrite }),
          409,
          'LAST_ADMINISTRATOR',
        )
        const role = assertOk(await iam.call('GET', `/roles/${managerRole}`, { token }))
        assertEquals(role.permissions.length, 6, 'the role keeps its permissions')
        await stillStanding()
      })

      await t.step('deactivating the permission role-write', async () => {
        assertRefused(
          await call('PATCH', `/permissions/${await tools.permissionId(P.roleWrite)}`, {
            isActive: false,
          }),
          409,
          'LAST_ADMINISTRATOR',
        )
        const permission = assertOk(
          await iam.call('GET', `/permissions/${await tools.permissionId(P.roleWrite)}`, { token }),
        )
        assertEquals(permission.isActive, true)
        await stillStanding()
      })

      await t.step(
        'deleting the administrator role is refused first because the account holds it',
        async () => {
          assertRefused(await call('DELETE', `/roles/${managerRole}`), 409, 'ROLE_HAS_HOLDERS')
          await stillStanding()
        },
      )

      await t.step('once a second administrator exists, the same changes are allowed', async () => {
        const second = await iam.register(token, 'second@iam-test.invalid')
        assertOk(
          await call('POST', '/roles/add', { authId: second.authId, roleIds: [managerRole] }),
        )
        // Now the first manager can step down: someone else still manages roles.
        assertOk(await call('PATCH', '/users/deactivate'))
        const blocked = await iam.call('POST', '/login/login', {
          body: { email: 'manager@iam-test.invalid', password: 'Test-Passw0rd-123!' },
        })
        assertEquals(blocked.status, 403)
        // And the second one is now the last: it cannot do the same.
        const secondToken = (await iam.login('second@iam-test.invalid')).accessToken
        assertRefused(
          await iam.call('PATCH', '/users/deactivate', { token: secondToken }),
          409,
          'LAST_ADMINISTRATOR',
        )
        assert(true)
      })
    } finally {
      await iam.stop()
    }
  },
})
