import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'

import { IAM_ERROR_CODES } from 'utils/constants.ts'
import {
  ADMIN_ROLE,
  buildWorld,
  perm,
  rejection,
  role,
  ROLE_WRITE,
  USER_ROLE,
} from '../../helpers/role-world.ts'

/**
 * Role lifecycle rules over the in-memory world: deleting a role that has holders, system roles,
 * the optimistic version of an edit, the holder listing, permission previews, and the dedupe of a
 * role's permissions.
 */

const ROOT = { subject: 'caller', scope: ['*'] }
const holder = (id: string, roleIds: string[]) => ({ id, userId: `user-${id}`, roleIds })
const VERSION = '2026-01-01T00:00:00.000Z'

Deno.test('deleteRole: a role with holders is not deleted; the rejection says how many and who', async () => {
  const accounts = Array.from({ length: 25 }, (_, i) => holder(`auth-${i}`, ['role-user']))
  const w = buildWorld({ accounts, session: ROOT })
  const error = await rejection(() => w.roles.deleteRole('role-user'))
  assertEquals(error.status.value, 409)
  assertEquals(error.code, IAM_ERROR_CODES.roleHasHolders)
  assertEquals(error.exposeMeta, true)
  assertEquals(error.meta?.holderCount, 25)
  assertEquals((error.meta?.holderIds as string[]).length, 20, 'the list is capped')
  assertEquals(w.state.deletedRoles, [])
})

Deno.test('deleteRole: once nobody holds the role it is deleted, and removing it from the holders first works', async () => {
  const w = buildWorld({
    accounts: [holder('auth-1', ['role-user']), holder('auth-2', ['role-root'])],
    session: ROOT,
  })
  await assertRejects(() => w.roles.deleteRole('role-user'), HttpError, 'held by 1 account')
  await w.roles.removeRoles({ authId: 'auth-1', roleIds: ['role-user'] } as never)
  await w.roles.deleteRole('role-user')
  assertEquals(w.state.deletedRoles, ['role-user'])
})

Deno.test('system roles: nobody edits or deletes one, not even a holder of *', async () => {
  const system = { ...role('role-system', [perm('web:user')]), isSystem: true }
  const w = buildWorld({ roles: [system, USER_ROLE], session: ROOT })
  for (
    const attempt of [
      () => w.roles.editRole('role-system', { name: 'Renamed' } as never),
      () => w.roles.editRole('role-system', { permissions: [] } as never),
      () => w.roles.deleteRole('role-system'),
    ]
  ) {
    // deno-lint-ignore no-await-in-loop
    const error = await rejection(attempt)
    assertEquals([error.status.value, error.code], [403, IAM_ERROR_CODES.roleIsSystem])
  }
  assertEquals([w.state.updatedRoles.length, w.state.deletedRoles.length], [0, 0])
  // A role without the field is an ordinary one.
  await w.roles.editRole('role-user', { name: 'Renamed' } as never)
})

Deno.test('system roles: only a holder of * creates one, and the flag is stored only when set', async () => {
  const scoped = buildWorld({ session: { subject: 'caller', scope: [ROLE_WRITE] } })
  const body = { name: 'Core', code: 'core', description: 'Core role', permissions: [] }
  const error = await rejection(() => scoped.roles.createRole({ ...body, isSystem: true } as never))
  assertEquals([error.status.value, error.code], [403, IAM_ERROR_CODES.roleGrantExceedsScope])
  assertEquals(error.meta, { missing: ['*'] })

  const root = buildWorld({ session: ROOT })
  await root.roles.createRole({ ...body, isSystem: true } as never)
  await root.roles.createRole({ ...body, code: 'plain' } as never)
  const [system, plain] = root.state.created as Record<string, unknown>[]
  assertEquals(system.isSystem, true)
  assertEquals('isSystem' in plain, false)
})

Deno.test('editRole: sending the version read applies the edit, and a stale one is a 409 with its code', async () => {
  const w = buildWorld({ session: ROOT })
  await w.roles.editRole('role-user', { name: 'First', updatedAt: VERSION } as never)
  // The role is at a new version now; the one the second client read is stale.
  const error = await rejection(() =>
    w.roles.editRole('role-user', { name: 'Second', updatedAt: VERSION } as never)
  )
  assertEquals([error.status.value, error.code], [409, IAM_ERROR_CODES.roleVersionConflict])
  assertEquals(w.state.updatedRoles.length, 1)
})

Deno.test('editRole: without a version the last edit wins (the version is optional)', async () => {
  const w = buildWorld({ session: ROOT })
  await w.roles.editRole('role-user', { name: 'First' } as never)
  await w.roles.editRole('role-user', { name: 'Second' } as never)
  assertEquals(w.state.updatedRoles.length, 2)
})

Deno.test('editRole: the version is also checked when the permissions change', async () => {
  const w = buildWorld({ session: ROOT })
  const error = await rejection(() =>
    w.roles.editRole('role-user', {
      permissions: ['p-web:user', 'p-seller:manage'],
      updatedAt: '2025-12-31T00:00:00.000Z',
    } as never)
  )
  assertEquals(error.code, IAM_ERROR_CODES.roleVersionConflict)
  assertEquals(w.state.updatedRoles.length, 0)
})

Deno.test('getRoleById: carries the version (updatedAt) and the holder count', async () => {
  const w = buildWorld({
    accounts: [holder('auth-1', ['role-user']), holder('auth-2', ['role-user'])],
  })
  const found = await w.roles.getRoleById('role-user') as unknown as Record<string, unknown>
  assertEquals(found.holderCount, 2)
  assertEquals((found.updatedAt as Date).toISOString(), VERSION)
  await assertRejects(() => w.roles.getRoleById('nope'), HttpError, 'Role not found')
})

Deno.test('getRoleHolders: one page of people with name and status, no contact data', async () => {
  const w = buildWorld({
    accounts: [
      holder('auth-1', ['role-user']),
      holder('auth-2', ['role-user']),
      holder('auth-3', ['role-user']),
      holder('auth-9', ['role-root']),
    ],
    profiles: { 'user-auth-1': 'ACTIVE', 'user-auth-2': 'INACTIVE', 'user-auth-3': 'ACTIVE' },
  })
  const page = await w.roles.getRoleHolders('role-user', { page: 1, limit: 2 })
  assertEquals(page.total, 3)
  assertEquals(page.docs.map((doc) => doc.authId), ['auth-1', 'auth-2'])
  assertEquals(page.docs[1], {
    authId: 'auth-2',
    userId: 'user-auth-2',
    firstName: 'Name user-auth-2',
    lastName: 'Surname',
    status: 'INACTIVE',
  })
  assertEquals(Object.keys(page.docs[0]).sort(), [
    'authId',
    'firstName',
    'lastName',
    'status',
    'userId',
  ])
  assertEquals((await w.roles.getRoleHolders('role-user', { page: 2, limit: 2 })).docs.length, 1)
  await assertRejects(() => w.roles.getRoleHolders('nope'), HttpError, 'Role not found')
})

Deno.test('users search and detail carry the account (authId) and its roleIds', async () => {
  const w = buildWorld({
    accounts: [holder('auth-1', ['role-user', 'role-seller'])],
    profiles: { 'user-auth-1': 'ACTIVE', 'user-lonely': 'ACTIVE' },
  })
  const page = await w.users.searchUsers({})
  const byId = Object.fromEntries(page.docs.map((doc) => [doc.id, doc]))
  assertEquals(
    [byId['user-auth-1'].authId, byId['user-auth-1'].roleIds],
    ['auth-1', ['role-user', 'role-seller']],
  )
  // A profile with no account has no authId and no roles.
  assertEquals([byId['user-lonely'].authId, byId['user-lonely'].roleIds], [undefined, []])
  const detail = await w.users.getUserById('user-auth-1') as unknown as Record<string, unknown>
  assertEquals([detail.authId, detail.roleIds], ['auth-1', ['role-user', 'role-seller']])
})

Deno.test('getAccountPermissions: the union of the roles with where each permission comes from', async () => {
  const dormant = role('role-dormant', [perm('orders:refund', false), perm('web:user')])
  const w = buildWorld({
    roles: [USER_ROLE, dormant, ADMIN_ROLE],
    accounts: [holder('auth-1', ['role-user', 'role-dormant', 'role-admin'])],
  })
  const result = await w.roles.getAccountPermissions('auth-1')
  assertEquals(result.roleIds, ['role-user', 'role-dormant', 'role-admin'])
  assertEquals(result.permissions, [
    { code: 'web:user', roles: ['role-user', 'role-dormant', 'role-admin'] },
    { code: ROLE_WRITE, roles: ['role-admin'] },
  ])
  await assertRejects(() => w.roles.getAccountPermissions('nope'), HttpError, 'Account not found')
})

Deno.test('createRole and editRole store each permission once', async () => {
  const w = buildWorld({ session: ROOT })
  await w.roles.createRole({
    name: 'Dup',
    code: 'dup',
    description: 'Dup role',
    permissions: ['p-web:user', 'p-web:user', 'p-seller:manage'],
  } as never)
  assertEquals((w.state.created[0] as { permissions: string[] }).permissions, [
    'p-web:user',
    'p-seller:manage',
  ])
  await w.roles.editRole('role-user', { permissions: ['p-web:user', 'p-web:user'] } as never)
  assertEquals((w.state.updatedRoles[0] as { permissions: string[] }).permissions, ['p-web:user'])
})
