import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'

import { IAM_ERROR_CODES } from 'utils/constants.ts'
import { buildWorld, perm, rejection, role, ROLE_WRITE } from '../../helpers/role-world.ts'

/**
 * "Grant only what you hold": `role-write` is not superadmin. Whoever assigns roles, creates or
 * edits a role, or deletes one may only touch permissions the caller's own session `scope` holds,
 * `*` covering all of them, and only a holder of `*` covers `*`. Taking away counts as much as
 * adding, so a `role-write` holder cannot degrade a more privileged account either.
 */

const SCOPED = { subject: 'caller', scope: [ROLE_WRITE, 'web:user'] }
const OUTSIDER = role('role-outsider', [perm('orders:refund')])
const ROOT = role('role-root', [perm('*')])
const INSIDER = role('role-insider', [perm('web:user')])
const target = (roleIds: string[]) => ({ id: 'auth-1', userId: 'user-1', roleIds })
const FORBIDDEN = 'cannot grant or take away permissions you do not hold'

Deno.test('assign/add/set: a role within the caller scope can be granted', async () => {
  const world = buildWorld({ roles: [INSIDER], accounts: [target([])], session: SCOPED })
  await world.roles.assignRole({ authId: 'auth-1', roleId: 'role-insider' } as never)
  await world.roles.setRoles('auth-1', [])
  await world.roles.addRoles({ authId: 'auth-1', roleIds: ['role-insider'] } as never)
  assertEquals(world.account('auth-1')?.roleIds, ['role-insider'])
})

Deno.test('assign/add/set: a role with a permission the caller lacks is FORBIDDEN, nothing written', async () => {
  const world = buildWorld({ roles: [OUTSIDER, ROOT], accounts: [target([])], session: SCOPED })
  const attempts = [
    () => world.roles.assignRole({ authId: 'auth-1', roleId: 'role-outsider' } as never),
    () => world.roles.addRoles({ authId: 'auth-1', roleIds: ['role-outsider'] } as never),
    () => world.roles.setRoles('auth-1', ['role-outsider']),
  ]
  for (const attempt of attempts) {
    // deno-lint-ignore no-await-in-loop
    await assertRejects(attempt, HttpError, FORBIDDEN)
  }
  assertEquals(world.state.writes.length, 0)
})

Deno.test('assign/add/set: only a holder of * can grant a role that carries *', async () => {
  const world = buildWorld({ roles: [ROOT], accounts: [target([])], session: SCOPED })
  await assertRejects(
    () => world.roles.addRoles({ authId: 'auth-1', roleIds: ['role-root'] } as never),
    HttpError,
    FORBIDDEN,
  )
  const root = buildWorld({
    roles: [ROOT],
    accounts: [target([])],
    session: { subject: 'caller', scope: ['*'] },
  })
  await root.roles.addRoles({ authId: 'auth-1', roleIds: ['role-root'] } as never)
  assertEquals(root.account('auth-1')?.roleIds, ['role-root'])
})

Deno.test('remove/assign/set: taking away a role the caller does not fully hold is FORBIDDEN', async () => {
  const world = buildWorld({
    roles: [OUTSIDER, INSIDER, ROOT],
    accounts: [target(['role-outsider', 'role-insider', 'role-root'])],
    session: SCOPED,
  })
  const attempts = [
    () => world.roles.removeRoles({ authId: 'auth-1', roleIds: ['role-root'] } as never),
    () => world.roles.removeRoles({ authId: 'auth-1', roleIds: ['role-outsider'] } as never),
    // Replacing drops the outsider and root roles.
    () => world.roles.assignRole({ authId: 'auth-1', roleId: 'role-insider' } as never),
    () => world.roles.setRoles('auth-1', ['role-insider']),
  ]
  for (const attempt of attempts) {
    // deno-lint-ignore no-await-in-loop
    await assertRejects(attempt, HttpError, FORBIDDEN)
  }
  assertEquals(world.account('auth-1')?.roleIds, ['role-outsider', 'role-insider', 'role-root'])
})

Deno.test('remove: taking away a role within the caller scope is allowed', async () => {
  const world = buildWorld({
    roles: [OUTSIDER, INSIDER],
    accounts: [target(['role-outsider', 'role-insider'])],
    session: SCOPED,
  })
  // Keeping the outsider role untouched is fine: only what changes is checked.
  await world.roles.removeRoles({ authId: 'auth-1', roleIds: ['role-insider'] } as never)
  assertEquals(world.account('auth-1')?.roleIds, ['role-outsider'])
})

Deno.test('a caller that holds nothing is refused before any grant is weighed', async () => {
  const world = buildWorld({
    roles: [INSIDER],
    accounts: [target([])],
    session: { subject: 'caller' },
  })
  const error = await rejection(() =>
    world.roles.addRoles({ authId: 'auth-1', roleIds: ['role-insider'] } as never)
  )
  assertEquals([error.status.value, error.code], [403, IAM_ERROR_CODES.actorLacksPermission])
  assertEquals(error.meta, { required: ROLE_WRITE })
})

Deno.test('a role whose only permissions are inactive grants nothing, so it can be assigned', async () => {
  const dormant = role('role-dormant', [perm('orders:refund', false)])
  const world = buildWorld({ roles: [dormant], accounts: [target([])], session: SCOPED })
  await world.roles.addRoles({ authId: 'auth-1', roleIds: ['role-dormant'] } as never)
  assertEquals(world.account('auth-1')?.roleIds, ['role-dormant'])
})

Deno.test('createRole: permissions outside the caller scope are FORBIDDEN; within it, allowed', async () => {
  const world = buildWorld({ roles: [OUTSIDER, INSIDER, ROOT], session: SCOPED })
  const make = (code: string, permissions: string[]) =>
    world.roles.createRole({ name: code, code, description: code, permissions } as never)
  await assertRejects(() => make('a', ['p-orders:refund']), HttpError, FORBIDDEN)
  await assertRejects(() => make('b', ['p-*']), HttpError, FORBIDDEN)
  await assertRejects(() => make('c', ['p-web:user', 'p-orders:refund']), HttpError, FORBIDDEN)
  assertEquals(world.state.created.length, 0)
  await make('d', ['p-web:user'])
  assertEquals(world.state.created.length, 1)
})

Deno.test('createRole: a holder of * can create a role carrying *', async () => {
  const world = buildWorld({ roles: [ROOT], session: { subject: 'caller', scope: ['*'] } })
  await world.roles.createRole(
    { name: 'x', code: 'x', description: 'x', permissions: ['p-*'] } as never,
  )
  assertEquals(world.state.created.length, 1)
})

Deno.test('editRole: adding or removing a permission the caller lacks is FORBIDDEN', async () => {
  const mixed = role('role-mixed', [perm('web:user'), perm('orders:refund')])
  const world = buildWorld({ roles: [mixed, OUTSIDER, ROOT], session: SCOPED })
  // Adds orders:refund... already there; adds `*`, which the caller lacks.
  await assertRejects(
    () =>
      world.roles.editRole(
        'role-mixed',
        { permissions: ['p-web:user', 'p-orders:refund', 'p-*'] } as never,
      ),
    HttpError,
    FORBIDDEN,
  )
  // Removes orders:refund, which the caller does not hold: degrading.
  await assertRejects(
    () => world.roles.editRole('role-mixed', { permissions: ['p-web:user'] } as never),
    HttpError,
    FORBIDDEN,
  )
  assertEquals(world.state.updatedRoles.length, 0)
})

Deno.test('editRole: changing only permissions within the caller scope, or no permissions at all, is allowed', async () => {
  const mixed = role('role-mixed', [perm('web:user'), perm('orders:refund')])
  const world = buildWorld({
    roles: [mixed, role('role-w', [perm(ROLE_WRITE)])],
    session: SCOPED,
  })
  // Keeps orders:refund untouched (unchanged permissions are not checked), adds ROLE_WRITE held.
  await world.roles.editRole('role-mixed', {
    permissions: ['p-web:user', 'p-orders:refund', `p-${ROLE_WRITE}`],
  } as never)
  await world.roles.editRole('role-mixed', { name: 'Renamed' } as never)
  assertEquals(world.state.updatedRoles.length, 2)
})

Deno.test('deleteRole: deleting a role with a permission the caller lacks is FORBIDDEN', async () => {
  const world = buildWorld({ roles: [OUTSIDER, INSIDER], session: SCOPED })
  await assertRejects(() => world.roles.deleteRole('role-outsider'), HttpError, FORBIDDEN)
  await world.roles.deleteRole('role-insider')
  assertEquals(world.state.deletedRoles, ['role-insider'])
})
