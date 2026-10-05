import { assertEquals } from 'jsr:@std/assert@0.224'

import { IAM_ERROR_CODES, RBAC_PERMISSIONS } from 'utils/constants.ts'
import { buildWorld, perm, rejection, role, ROLE_WRITE } from '../../helpers/role-world.ts'

/**
 * `user-write` is not a license to lock out anyone: blocking a person (INACTIVE/DELETED through
 * `PATCH /users/:id`) takes away everything their roles grant, so the caller must hold all of it.
 * The person's own deactivation and deletion are about oneself and are exempt.
 */

const USER_WRITE = RBAC_PERMISSIONS.userWrite
const people = (...roles: string[][]) =>
  roles.map((roleIds, i) => ({ id: `auth-${i + 1}`, userId: `user-${i + 1}`, roleIds }))
const ACTIVE = { 'user-1': 'ACTIVE', 'user-2': 'ACTIVE', 'user-3': 'ACTIVE' }
const block = (w: ReturnType<typeof buildWorld>, userId: string) =>
  w.users.updateUserById(userId, { status: 'INACTIVE' } as never)

Deno.test('a user-write holder cannot block a person whose roles grant what it does not hold', async () => {
  const w = buildWorld({
    accounts: people(['role-admin'], ['role-root']),
    profiles: ACTIVE,
    session: { subject: 'svc', scope: [USER_WRITE, 'web:user'] },
  })
  for (const userId of ['user-1', 'user-2']) {
    // deno-lint-ignore no-await-in-loop
    const error = await rejection(() => block(w, userId))
    assertEquals([error.status.value, error.code], [403, IAM_ERROR_CODES.roleGrantExceedsScope])
  }
  assertEquals(w.state.profiles['user-1'], 'ACTIVE')
  assertEquals(w.state.updatedUsers.length, 0)
})

Deno.test('it can block a person it covers, one with no roles, and one with no account', async () => {
  const w = buildWorld({
    accounts: people(['role-user'], []),
    profiles: { ...ACTIVE, 'user-9': 'ACTIVE' },
    session: { subject: 'svc', scope: [USER_WRITE, 'web:user'] },
  })
  await block(w, 'user-1')
  await block(w, 'user-2')
  await block(w, 'user-9')
  assertEquals(
    [w.state.profiles['user-1'], w.state.profiles['user-2'], w.state.profiles['user-9']],
    ['INACTIVE', 'INACTIVE', 'INACTIVE'],
  )
})

Deno.test('a holder of * can block anyone, and the last administrator only by blocking itself', async () => {
  const w = buildWorld({
    accounts: people(['role-admin'], ['role-root']),
    profiles: ACTIVE,
    session: { subject: 'svc', scope: ['*'] },
  })
  // The caller is itself an administrator, so blocking the others leaves one.
  await block(w, 'user-1')
  await block(w, 'user-2')
  // Blocking the caller's own profile would leave nobody: refused.
  const own = buildWorld({
    roles: [role('role-manager', [perm(ROLE_WRITE), perm(USER_WRITE)])],
    accounts: [{ id: 'auth-1', userId: 'user-1', roleIds: ['role-manager'] }],
    profiles: { 'user-1': 'ACTIVE' },
    session: { subject: 'auth-1' },
  })
  const error = await rejection(() => block(own, 'user-1'))
  assertEquals(error.code, IAM_ERROR_CODES.lastAdministrator)
})

Deno.test('the person can deactivate or delete their own account whatever their roles grant', async () => {
  const w = buildWorld({
    accounts: people(['role-admin'], ['role-root']),
    profiles: ACTIVE,
    session: { subject: 'auth-1', scope: [] },
  })
  // The caller's token says nothing and its roles outrank what any scope here would cover; the
  // rule does not apply to oneself. Another administrator remains, so it also passes the last-one rule.
  await w.users.deactivateOwnAccount()
  assertEquals(w.state.profiles['user-1'], 'INACTIVE')
})

Deno.test('edits that do not block (a name) need no coverage of the person', async () => {
  const w = buildWorld({
    accounts: people(['role-root']),
    profiles: ACTIVE,
    session: { subject: 'svc', scope: [USER_WRITE] },
  })
  await w.users.updateUserById('user-1', { firstName: 'Jane' } as never)
  assertEquals(w.state.updatedUsers.length, 1)
})
