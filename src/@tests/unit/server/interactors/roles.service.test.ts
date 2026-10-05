import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'

import { IAM_ERROR_CODES } from 'utils/constants.ts'
import { buildWorld, rejection, role } from '../../helpers/role-world.ts'

/**
 * `RolesService` CRUD and account-role membership over the in-memory world of
 * `helpers/role-world.ts`. The two rules every mutation shares have their own files:
 * `roles.service.grant-rules.test.ts` (grant only what you hold) and
 * `roles.service.admin-remains.test.ts` (an administrator remains).
 */

const account = (roleIds?: string[], id = 'auth-1') => ({ id, userId: `user-${id}`, roleIds })

Deno.test('createRole: throws CONFLICT when the code already exists', async () => {
  const { roles } = buildWorld({ roles: [role('r1', [])] })
  await assertRejects(
    () => roles.createRole({ code: 'r1', permissions: [] } as never),
    HttpError,
    'already exists',
  )
})

Deno.test('createRole: throws BAD_REQUEST when a referenced permission does not exist', async () => {
  const { roles, state } = buildWorld()
  await assertRejects(
    () => roles.createRole({ code: 'new', permissions: ['p-missing'] } as never),
    HttpError,
    'One or more permissions do not exist',
  )
  assertEquals(state.created.length, 0)
})

Deno.test('createRole: persists the role with the caller as createdBy', async () => {
  const { roles, state } = buildWorld({ session: { subject: 'admin-1', scope: ['*'] } })
  const result = await roles.createRole({
    name: 'N',
    code: 'new',
    description: 'D',
    permissions: ['p-web:user'],
  } as never)
  assertEquals(result, { response: 'role created' })
  assertEquals(state.created, [{
    name: 'N',
    code: 'new',
    description: 'D',
    tenantId: undefined,
    permissions: ['p-web:user'],
    createdBy: 'admin-1',
  }])
})

Deno.test('createRole: the collision check is scoped to the tenant, global when none', async () => {
  const { roles } = buildWorld({ roles: [role('r1', [], 'tenant-a'), role('global', [])] })
  // Same code in another tenant, and the tenant role's code globally, do not collide.
  await roles.createRole({ code: 'r1', tenantId: 'tenant-b', permissions: [] } as never)
  await roles.createRole({ code: 'r1', permissions: [] } as never)
  await assertRejects(
    () => roles.createRole({ code: 'r1', tenantId: 'tenant-a', permissions: [] } as never),
    HttpError,
    'for this tenant',
  )
  await assertRejects(
    () => roles.createRole({ code: 'global', permissions: [] } as never),
    HttpError,
    'already exists',
  )
})

Deno.test('editRole: NOT_FOUND for an unknown role; permissions are validated only when given', async () => {
  const { roles, state } = buildWorld()
  await assertRejects(() => roles.editRole('nope', {} as never), HttpError, 'Role not found')
  await roles.editRole('role-user', { name: 'Renamed' } as never)
  assertEquals(state.updatedRoles, [{ name: 'Renamed', id: 'role-user' }])
  await assertRejects(
    () => roles.editRole('role-user', { permissions: ['p-missing'] } as never),
    HttpError,
    'One or more permissions do not exist',
  )
})

Deno.test('editRole: applies a permissions list whose ids all exist', async () => {
  const { roles, state } = buildWorld()
  await roles.editRole('role-user', { permissions: ['p-web:user', 'p-seller:manage'] } as never)
  assertEquals(state.updatedRoles, [{
    permissions: ['p-web:user', 'p-seller:manage'],
    id: 'role-user',
  }])
})

Deno.test('deleteRole: NOT_FOUND for an unknown role, otherwise deletes it', async () => {
  const { roles, state } = buildWorld()
  await assertRejects(() => roles.deleteRole('nope'), HttpError, 'Role not found')
  assertEquals(await roles.deleteRole('role-user'), { response: 'role deleted' })
  assertEquals(state.deletedRoles, ['role-user'])
})

Deno.test('getRoleById / getRoles: read through the repository', async () => {
  const { roles } = buildWorld()
  assertEquals((await roles.getRoleById('role-user')).id, 'role-user')
  await assertRejects(() => roles.getRoleById('nope'), HttpError, 'Role not found')
  assertEquals((await roles.getRoles({ tenantId: 't' })).total, 0)
})

Deno.test('assignRole: replaces the roles with [roleId] and writes nothing else', async () => {
  const { roles, state, account: read } = buildWorld({
    accounts: [account(['role-user', 'role-seller'])],
  })
  assertEquals(await roles.assignRole({ authId: 'auth-1', roleId: 'role-seller' } as never), {
    response: 'role assigned',
  })
  assertEquals(read('auth-1')?.roleIds, ['role-seller'])
  assertEquals(state.writes, [['replace', 'auth-1', ['role-seller']]])
})

Deno.test('assignRole: NOT_FOUND for a missing role or account', async () => {
  const { roles } = buildWorld({ accounts: [account()] })
  await assertRejects(
    () => roles.assignRole({ authId: 'auth-1', roleId: 'missing' } as never),
    HttpError,
    'Role not found',
  )
  await assertRejects(
    () => roles.assignRole({ authId: 'missing', roleId: 'role-user' } as never),
    HttpError,
    'Account not found',
  )
})

Deno.test('addRoles: keeps the roles held and appends the new ones once, in one atomic add', async () => {
  const { roles, state } = buildWorld({ accounts: [account(['role-user'])] })
  const result = await roles.addRoles({
    authId: 'auth-1',
    roleIds: ['role-seller', 'role-user', 'role-seller'],
  } as never)
  assertEquals(result, { response: 'roles updated', roleIds: ['role-user', 'role-seller'] })
  assertEquals(state.writes, [['add', 'auth-1', ['role-seller']]])
})

Deno.test('addRoles: an account with no roles yet gets them; repeating changes nothing', async () => {
  const { roles, state } = buildWorld({ accounts: [account()] })
  await roles.addRoles({ authId: 'auth-1', roleIds: ['role-user'] } as never)
  const again = await roles.addRoles({ authId: 'auth-1', roleIds: ['role-user'] } as never)
  assertEquals(again.roleIds, ['role-user'])
  assertEquals(state.writes.length, 1, 'the repeat must not write')
})

Deno.test('addRoles: NOT_FOUND for a missing role or account, nothing written', async () => {
  const { roles, state } = buildWorld({ accounts: [account()] })
  await assertRejects(
    () => roles.addRoles({ authId: 'auth-1', roleIds: ['x'] } as never),
    HttpError,
    'Role not found',
  )
  await assertRejects(
    () => roles.addRoles({ authId: 'nobody', roleIds: ['role-user'] } as never),
    HttpError,
    'Account not found',
  )
  assertEquals(state.writes.length, 0)
})

Deno.test('addRoles/removeRoles/setRoles: the roles involved are read with one query', async () => {
  const { roles, state } = buildWorld({ accounts: [account(['role-user'])] })
  await roles.addRoles({ authId: 'auth-1', roleIds: ['role-seller', 'role-seller'] } as never)
  assertEquals(state.findRoleQueries, [['role-actor-caller', 'role-seller']])
})

Deno.test('removeRoles: pulls only the roles held and ignores the others', async () => {
  const { roles, state } = buildWorld({ accounts: [account(['role-user', 'role-seller'])] })
  const result = await roles.removeRoles({
    authId: 'auth-1',
    roleIds: ['role-seller', 'role-admin'],
  } as never)
  assertEquals(result, { response: 'roles updated', roleIds: ['role-user'] })
  assertEquals(state.writes, [['pull', 'auth-1', ['role-seller']]])
})

Deno.test('removeRoles: removing the last role leaves the account with none', async () => {
  const { roles, account: read } = buildWorld({ accounts: [account(['role-user'])] })
  await roles.removeRoles({ authId: 'auth-1', roleIds: ['role-user'] } as never)
  assertEquals(read('auth-1')?.roleIds, [])
})

Deno.test('setRoles: stores exactly the given roles in order; an empty list clears them', async () => {
  const { roles, account: read } = buildWorld({ accounts: [account(['role-user'])] })
  assertEquals(
    (await roles.setRoles('auth-1', ['role-seller', 'role-user', 'role-seller'])).roleIds,
    [
      'role-seller',
      'role-user',
    ],
  )
  await roles.setRoles('auth-1', [])
  assertEquals(read('auth-1')?.roleIds, [])
})

Deno.test('setRoles: NOT_FOUND when one of the roles does not exist, nothing written', async () => {
  const { roles, state } = buildWorld({ accounts: [account()] })
  await assertRejects(() => roles.setRoles('auth-1', ['x']), HttpError, 'Role not found')
  assertEquals(state.writes.length, 0)
})

Deno.test('getAccountRoles: answers the role ids, empty when none, NOT_FOUND for no account', async () => {
  const { roles } = buildWorld({
    accounts: [account(['role-user', 'role-seller']), account(undefined, 'auth-2')],
  })
  assertEquals(await roles.getAccountRoles('auth-1'), {
    authId: 'auth-1',
    roleIds: ['role-user', 'role-seller'],
  })
  assertEquals((await roles.getAccountRoles('auth-2')).roleIds, [])
  await assertRejects(() => roles.getAccountRoles('x'), HttpError, 'Account not found')
})

Deno.test('role changes: nobody changes their own roles, with every operation', async () => {
  const { roles, state } = buildWorld({
    accounts: [account(['role-user'], 'caller')],
    session: { subject: 'caller', scope: ['*'] },
  })
  const attempts = [
    () => roles.assignRole({ authId: 'caller', roleId: 'role-seller' } as never),
    () => roles.addRoles({ authId: 'caller', roleIds: ['role-seller'] } as never),
    () => roles.removeRoles({ authId: 'caller', roleIds: ['role-user'] } as never),
    () => roles.setRoles('caller', ['role-seller']),
  ]
  for (const attempt of attempts) {
    // deno-lint-ignore no-await-in-loop
    const error = await rejection(attempt)
    assertEquals([error.status.value, error.code], [403, IAM_ERROR_CODES.roleSelfChange])
  }
  assertEquals(state.writes.length, 0)
})

Deno.test('a removal reads the role catalog twice (before and after the write), not three times', async () => {
  const w = buildWorld({
    accounts: [
      { id: 'auth-1', userId: 'user-auth-1', roleIds: ['role-admin'] },
      { id: 'auth-2', userId: 'user-auth-2', roleIds: ['role-admin'] },
    ],
  })
  await w.roles.removeRoles({ authId: 'auth-1', roleIds: ['role-admin'] } as never)
  assertEquals(w.state.catalogReads, 2)
})

Deno.test('editRole with permissions, deleteRole and a status block read the catalog once to decide, and once to verify', async () => {
  const admins = [
    { id: 'auth-2', userId: 'user-auth-2', roleIds: ['role-root'] },
    { id: 'auth-1', userId: 'user-auth-1', roleIds: ['role-user'] },
  ]
  const edit = buildWorld({ accounts: admins })
  await edit.roles.editRole('role-seller', { permissions: ['p-web:user'] } as never)
  assertEquals(edit.state.catalogReads, 2)
  const del = buildWorld({ accounts: admins })
  await del.roles.deleteRole('role-seller')
  assertEquals(del.state.catalogReads, 2)
  const block = buildWorld({ accounts: admins, profiles: { 'user-auth-1': 'ACTIVE' } })
  await block.users.updateUserById('user-auth-1', { status: 'INACTIVE' } as never)
  assertEquals(block.state.catalogReads, 2)
})

Deno.test('a concurrent change makes the write repeat against the new state', async () => {
  const world = buildWorld({ accounts: [account(['role-user', 'role-seller'])] })
  let interfered = false
  world.state.beforeConditionalWrite = () => {
    if (interfered) return
    interfered = true
    // Another request added a role between the read and the conditional write.
    world.setRolesDirectly('auth-1', ['role-user', 'role-seller', 'role-admin'])
  }
  const result = await world.roles.removeRoles(
    { authId: 'auth-1', roleIds: ['role-seller'] } as never,
  )
  assertEquals(result.roleIds, ['role-user', 'role-admin'])
  assertEquals(world.account('auth-1')?.roleIds, ['role-user', 'role-admin'])
})

Deno.test('a change that keeps losing the race is refused after three attempts', async () => {
  const world = buildWorld({ accounts: [account(['role-user', 'role-seller'])] })
  let counter = 0
  world.state.beforeConditionalWrite = () => {
    world.setRolesDirectly('auth-1', ['role-user', 'role-seller', `role-extra-${counter++}`])
  }
  const error = await rejection(() =>
    world.roles.removeRoles({ authId: 'auth-1', roleIds: ['role-seller'] } as never)
  )
  assertEquals([error.status.value, error.code], [409, IAM_ERROR_CODES.roleConcurrentChange])
  assertEquals(world.state.writes.length, 0)
})
