import { assertEquals } from 'jsr:@std/assert@0.224'
import { ZanixMongoConnector } from '@zanix/datamaster'

import 'server/repositories/auth/model.defs.ts'
import 'server/repositories/roles/model.defs.ts'
import 'server/repositories/permissions/model.defs.ts'
import { mongoUri, TEST_DB_PREFIX } from '../../../support/e2e.ts'
import { AuthRepository } from 'server/repositories/auth/entity.provider.ts'
import { PermissionsRepository } from 'server/repositories/permissions/entity.provider.ts'
import { RolesRepository } from 'server/repositories/roles/entity.provider.ts'

/**
 * The array primitives the role rules depend on, against a REAL MongoDB: exact array equality (the
 * condition of `replaceRoleIds`/`pullRoleIds`), `$pull`, `$addToSet`, `$in` counts, `populate`, and
 * restoring a deleted role under its id. A mock cannot prove these: they are MongoDB semantics.
 * Skipped unless `IAM_TEST_MONGO_URI` points at a MongoDB the test may write to; it uses a
 * throw-away database of its own and drops it.
 *
 *   IAM_TEST_MONGO_URI=mongodb://localhost:27017 deno test -A \
 *     src/@tests/integration/server/repositories/auth-array-primitives.test.ts
 */
const uri = mongoUri

const ROLE_A = '693000000000000000000a01'
const ROLE_B = '693000000000000000000a02'
const ROLE_C = '693000000000000000000a03'

/** A repository bound to `connector`, the way the DI container would build it. */
function bound<T extends object>(
  Repository: { prototype: object },
  connector: ZanixMongoConnector,
) {
  Object.defineProperty(Repository.prototype, 'database', {
    get: () => connector,
    configurable: true,
  })
  try {
    return new (Repository as unknown as new () => T)()
  } finally {
    delete (Repository.prototype as unknown as { database?: unknown }).database
  }
}

Deno.test({
  name:
    'mongo: exact-array conditions, $pull, $addToSet, $in counts, populate and restore behave as the rules assume',
  ignore: !uri,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // The environment is process-wide and shared with the other test files: set what this needs,
    // put it back in the `finally`.
    const previous = {
      seeders: Deno.env.get('DATABASE_SEEDERS'),
      key: Deno.env.get('DATA_SECRET_KEY'),
    }
    Deno.env.set('DATABASE_SEEDERS', 'false')
    // Protected fields (the email) need a key; this one is for this throw-away database only.
    Deno.env.set('DATA_SECRET_KEY', 'iam-integration-test-key-not-a-secret')
    const dbName = `${TEST_DB_PREFIX}${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
    const connector = new ZanixMongoConnector({
      uri,
      seedModel: false,
      triggersModel: false,
      config: { dbName },
    })
    await connector.isReady
    try {
      const auth = bound<AuthRepository>(AuthRepository, connector)
      const roles = bound<RolesRepository>(RolesRepository, connector)
      const permissions = bound<PermissionsRepository>(PermissionsRepository, connector)
      const rolesOf = async (authId: string) => (await auth.findById(authId))?.roleIds?.map(String)

      const created = await auth.registerAuth({
        email: 'a@example.com',
        roleIds: [ROLE_A, ROLE_B],
      })
      const id = String(created.id)

      // replaceRoleIds: exact equality, order included.
      assertEquals(await auth.replaceRoleIds(id, [ROLE_B, ROLE_A], [ROLE_C]), false)
      assertEquals(await auth.replaceRoleIds(id, [ROLE_A, ROLE_B], [ROLE_C]), true)
      assertEquals(await rolesOf(id), [ROLE_C])

      // $addToSet keeps existing roles, appends new ones, never repeats.
      await auth.addRoleIds(id, [ROLE_A, ROLE_C, ROLE_A])
      assertEquals(await rolesOf(id), [ROLE_C, ROLE_A])

      // $pull under the same exact-equality condition.
      assertEquals(await auth.pullRoleIds(id, [ROLE_A], [ROLE_A]), false)
      assertEquals(await auth.pullRoleIds(id, [ROLE_C, ROLE_A], [ROLE_C]), true)
      assertEquals(await rolesOf(id), [ROLE_A])

      // An account with no roles matches the empty-list condition.
      await auth.replaceRoleIds(id, [ROLE_A], [])
      assertEquals(await auth.replaceRoleIds(id, [], [ROLE_B]), true)

      // Holders: $in over roleIds, excluding one account.
      await auth.registerAuth({ email: 'b@example.com', roleIds: [ROLE_B, ROLE_C] })
      assertEquals(await auth.countHolders(ROLE_B), 2)
      assertEquals((await auth.findHoldersOfRoleIds([ROLE_C])).length, 1)
      assertEquals((await auth.findHoldersOfRoleIds([ROLE_B, ROLE_C], id)).length, 1)

      // Roles with their permissions populated, read with one query.
      const permission = await permissions.createPermission({
        code: 'orders:read',
        name: 'Read orders',
        description: 'Read orders',
      })
      const role = await roles.createRole({
        name: 'Orders',
        code: 'orders',
        description: 'Orders',
        permissions: [String(permission.id)],
      })
      const roleId = String(role.id)
      const [populated] = await roles.findManyWithPermissions([roleId])
      assertEquals(populated.permissions?.map((entry) => entry.code), ['orders:read'])

      // Conditional replace of a role's permissions, and restoring a deleted role under its id.
      assertEquals(await roles.replacePermissions(roleId, [], []), false)
      assertEquals(await roles.replacePermissions(roleId, [String(permission.id)], []), true)
      await roles.deleteRole(roleId)
      const snapshot = { id: roleId, name: 'Orders', code: 'orders', description: 'Orders' }
      assertEquals(await roles.restoreRole(snapshot), true)
      assertEquals(await roles.restoreRole(snapshot), false)
      assertEquals(String((await roles.findById(roleId))?.id), roleId)
    } finally {
      // Drop the throw-away database, then close the connection.
      await connector.getModel('auth').db.dropDatabase()
      await (connector as unknown as { close: () => Promise<void> }).close()
      for (
        const [name, value] of [['DATABASE_SEEDERS', previous.seeders], [
          'DATA_SECRET_KEY',
          previous.key,
        ]] as const
      ) {
        if (value === undefined) Deno.env.delete(name)
        else Deno.env.set(name, value)
      }
    }
  },
})
