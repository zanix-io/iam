import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'

import {
  assertAdministratorRemains,
  countActiveAdministrators,
} from 'server/interactors/role-admin.ts'
import { IAM_ERROR_CODES, RBAC_PERMISSIONS } from 'utils/constants.ts'
import {
  ADMIN_ROLE,
  buildWorld,
  type FakeAccount,
  perm,
  rejection,
  role,
  ROLE_WRITE,
  ROOT_ROLE,
  USER_ROLE,
  type WorldInit,
} from '../../helpers/role-world.ts'

/**
 * "An administrator remains". Two levels, because of what a caller can reach:
 *
 * 1. The rule itself (`countActiveAdministrators`, `assertAdministratorRemains`), tested directly
 *    against hypothetical changes: who counts as an administrator and which changes leave none.
 * 2. The operations that reach it. A caller that can change roles holds `role-write`, so it is an
 *    administrator that stays; a change of ANOTHER account's roles can therefore only end in
 *    `LAST_ADMINISTRATOR` under a race (`roles.service.races.test.ts`). What a person can reach
 *    here is the caller's own profile, the role that makes it an administrator and the permission
 *    that does.
 */
const P = RBAC_PERMISSIONS
const LAST = 'The last account able to manage roles cannot lose that ability.'
const holder = (id: string, roleIds: string[]): FakeAccount => ({
  id,
  userId: `user-${id}`,
  roleIds,
})
const ACTIVE = { 'user-auth-1': 'ACTIVE', 'user-auth-2': 'ACTIVE', 'user-auth-3': 'ACTIVE' }

// ---- 1. The rule ----------------------------------------------------------------------------

/** A world whose caller is not an administrator, only here to be a valid `providers`. */
const rule = (init: WorldInit) => buildWorld({ session: { subject: 'viewer' }, ...init })

/** What the rule says about `auth-1` ending up with `roleIds`. */
const losing = (w: ReturnType<typeof buildWorld>, roleIds: string[]) =>
  assertAdministratorRemains(w.providers as never, {
    kind: 'account-roles',
    authId: 'auth-1',
    userId: 'user-auth-1',
    roleIds,
  })

Deno.test('the rule: the last administrator cannot lose the ability, by any change of its roles', async () => {
  const w = rule({ accounts: [holder('auth-1', ['role-admin', 'role-user'])], profiles: ACTIVE })
  for (const roleIds of [['role-user'], []]) {
    // deno-lint-ignore no-await-in-loop
    await assertRejects(() => losing(w, roleIds), HttpError, LAST)
  }
  assertEquals(await losing(w, ['role-admin']), true, 'keeping it is fine')
})

Deno.test('the rule: the wildcard counts, and swapping one qualifying role for another is allowed', async () => {
  const w = rule({ accounts: [holder('auth-1', ['role-root'])], profiles: ACTIVE })
  await assertRejects(() => losing(w, []), HttpError, LAST)
  assertEquals(await losing(w, ['role-admin']), true)
})

Deno.test('the rule: another active administrator makes any change fine', async () => {
  const w = rule({
    accounts: [holder('auth-1', ['role-admin']), holder('auth-2', ['role-admin'])],
    profiles: ACTIVE,
  })
  assertEquals(await losing(w, []), true)
})

Deno.test('the rule: an administrator whose profile cannot sign in does not count', async () => {
  for (const status of ['INACTIVE', 'DELETED']) {
    const w = rule({
      accounts: [holder('auth-1', ['role-admin']), holder('auth-2', ['role-admin'])],
      profiles: { ...ACTIVE, 'user-auth-2': status },
    })
    // deno-lint-ignore no-await-in-loop
    await assertRejects(() => losing(w, []), HttpError, LAST)
  }
})

Deno.test('the rule: one active holder among inactive ones is enough', async () => {
  const w = rule({
    accounts: [
      holder('auth-1', ['role-admin']),
      holder('auth-2', ['role-admin']),
      holder('auth-3', ['role-root']),
    ],
    profiles: { ...ACTIVE, 'user-auth-2': 'INACTIVE' },
  })
  assertEquals(await losing(w, []), true)
})

Deno.test('the rule: taking the role from an account that cannot sign in loses nobody', async () => {
  for (const status of ['INACTIVE', 'DELETED']) {
    const w = rule({
      accounts: [holder('auth-1', ['role-admin']), holder('auth-2', ['role-admin'])],
      profiles: { ...ACTIVE, 'user-auth-1': status },
    })
    // deno-lint-ignore no-await-in-loop
    assertEquals(await losing(w, []), true)
  }
  // Even when it is the only holder: it was not an administrator able to sign in to begin with.
  const alone = rule({
    accounts: [holder('auth-1', ['role-admin'])],
    profiles: { ...ACTIVE, 'user-auth-1': 'INACTIVE' },
  })
  assertEquals(await losing(alone, []), false, 'nothing to protect')
})

Deno.test('the rule: an account with no profile, or a dangling userId, is a holder that can sign in', async () => {
  const noProfile = rule({
    accounts: [holder('auth-1', ['role-admin']), { id: 'auth-2', roleIds: ['role-admin'] }],
    profiles: ACTIVE,
  })
  assertEquals(await losing(noProfile, []), true)
  // `user-auth-2` matches no profile: the login gate lets it through, so it counts.
  const dangling = rule({
    accounts: [holder('auth-1', ['role-admin']), holder('auth-2', ['role-admin'])],
    profiles: { 'user-auth-1': 'ACTIVE' },
  })
  assertEquals(await losing(dangling, []), true)
})

Deno.test('the rule: a tenant-scoped role with role-write counts as administration', async () => {
  const tenantAdmin = role('role-tenant-admin', [perm(ROLE_WRITE)], 'tenant-a')
  const w = rule({
    roles: [ADMIN_ROLE, tenantAdmin, USER_ROLE],
    accounts: [holder('auth-1', ['role-admin']), holder('auth-2', ['role-tenant-admin'])],
    profiles: ACTIVE,
  })
  assertEquals(await losing(w, []), true)
})

Deno.test('the rule: an inactive role-write permission does not make an administrator', async () => {
  const dormant = role('role-dormant', [perm(ROLE_WRITE, false)])
  const w = rule({
    roles: [ADMIN_ROLE, dormant],
    accounts: [holder('auth-1', ['role-admin']), holder('auth-2', ['role-dormant'])],
    profiles: ACTIVE,
  })
  assertEquals(await countActiveAdministrators(w.providers as never), 1)
  await assertRejects(() => losing(w, []), HttpError, LAST)
})

Deno.test('the rule: a system with no administrator at all has nothing to protect', async () => {
  const w = rule({
    roles: [USER_ROLE],
    accounts: [holder('auth-1', ['role-user'])],
    profiles: ACTIVE,
  })
  assertEquals(await losing(w, []), false)
})

Deno.test('the rule: role edits, role deletes and permission deactivation are judged on the state they produce', async () => {
  const w = rule({ accounts: [holder('auth-1', ['role-admin'])], profiles: ACTIVE })
  const providers = w.providers as never
  const withoutRoleWrite = [perm('web:user')]
  await assertRejects(
    () =>
      assertAdministratorRemains(providers, {
        kind: 'role-permissions',
        roleId: 'role-admin',
        permissions: withoutRoleWrite as never,
      }),
    HttpError,
    LAST,
  )
  await assertRejects(
    () => assertAdministratorRemains(providers, { kind: 'role-deleted', roleId: 'role-admin' }),
    HttpError,
    LAST,
  )
  await assertRejects(
    () =>
      assertAdministratorRemains(providers, {
        kind: 'permission-deactivated',
        permissionId: `p-${ROLE_WRITE}`,
      }),
    HttpError,
    LAST,
  )
  await assertRejects(
    () => assertAdministratorRemains(providers, { kind: 'user-blocked', userId: 'user-auth-1' }),
    HttpError,
    LAST,
  )
  // A change that does not touch what makes the administrator passes.
  assertEquals(
    await assertAdministratorRemains(providers, {
      kind: 'role-permissions',
      roleId: 'role-user',
      permissions: [] as never,
    }),
    true,
  )
  assertEquals(
    await assertAdministratorRemains(providers, { kind: 'user-blocked', userId: 'user-auth-9' }),
    true,
  )
})

// ---- 2. The operations that reach it ---------------------------------------------------------

/** `solo` is the only administrator: role-write, permission-write and user-write, no `*`. */
const MANAGER = role('role-manager', [
  perm(ROLE_WRITE),
  perm(P.permissionWrite),
  perm(P.userWrite),
  perm('web:user'),
])
const solo = (extra: WorldInit = {}) =>
  buildWorld({
    roles: [MANAGER, USER_ROLE, ROOT_ROLE],
    accounts: [holder('solo', ['role-manager'])],
    profiles: { 'user-solo': 'ACTIVE' },
    session: { subject: 'solo' },
    ...extra,
  })

Deno.test('the only administrator cannot block its own profile, through any path', async () => {
  const w = solo()
  const attempts = [
    () => w.users.updateUserById('user-solo', { status: 'INACTIVE' } as never),
    () => w.users.updateUserById('user-solo', { status: 'DELETED' } as never),
    () => w.users.deactivateOwnAccount(),
    () => w.users.deleteOwnAccount(),
  ]
  for (const attempt of attempts) {
    // deno-lint-ignore no-await-in-loop
    const error = await rejection(attempt)
    assertEquals([error.status.value, error.code], [409, IAM_ERROR_CODES.lastAdministrator])
  }
  assertEquals(w.state.updatedUsers.length, 0)
})

Deno.test('editing the role that makes the administrator so, to drop role-write, is refused; keeping it is not', async () => {
  const w = solo()
  const without = ['p-web:user', `p-${P.permissionWrite}`, `p-${P.userWrite}`]
  const error = await rejection(() =>
    w.roles.editRole('role-manager', { permissions: without } as never)
  )
  assertEquals(error.code, IAM_ERROR_CODES.lastAdministrator)
  assertEquals(w.state.updatedRoles.length, 0)
  await w.roles.editRole('role-manager', { permissions: [...without, `p-${ROLE_WRITE}`] } as never)
  assertEquals(w.state.updatedRoles.length, 1)
})

Deno.test('another role that carries role-write makes the same edit fine', async () => {
  const w = solo({
    accounts: [holder('solo', ['role-manager']), holder('other', ['role-root'])],
    profiles: { 'user-solo': 'ACTIVE', 'user-other': 'ACTIVE' },
  })
  await w.roles.editRole('role-manager', { permissions: ['p-web:user'] } as never)
  assertEquals(w.state.updatedRoles.length, 1)
})

Deno.test('deleting the administrator role is refused first because the account holds it', async () => {
  const w = solo()
  const error = await rejection(() => w.roles.deleteRole('role-manager'))
  assertEquals(error.code, IAM_ERROR_CODES.roleHasHolders)
  assertEquals(w.state.deletedRoles.length, 0)
})

Deno.test('deleting a role nobody holds is fine while an administrator remains', async () => {
  const w = solo()
  await w.roles.deleteRole('role-user')
  assertEquals(w.state.deletedRoles, ['role-user'])
})

Deno.test('deactivating the permission that makes the only administrator is refused; another route to it makes it fine', async () => {
  const w = solo()
  const error = await rejection(() =>
    w.permissions.editPermission(`p-${ROLE_WRITE}`, { isActive: false } as never)
  )
  assertEquals(error.code, IAM_ERROR_CODES.lastAdministrator)
  assertEquals(w.roleById('role-manager').permissions[0].isActive, true)

  const second = solo({
    accounts: [holder('solo', ['role-manager']), holder('other', ['role-root'])],
    profiles: { 'user-solo': 'ACTIVE', 'user-other': 'ACTIVE' },
  })
  await second.permissions.editPermission(`p-${ROLE_WRITE}`, { isActive: false } as never)
  assertEquals(second.state.updatedPermissions.length, 1)
})

Deno.test('the wildcard permission is protected the same way', async () => {
  const w = buildWorld({
    roles: [ROOT_ROLE, role('role-perm', [perm(P.permissionWrite)])],
    accounts: [holder('boss', ['role-root', 'role-perm'])],
    profiles: { 'user-boss': 'ACTIVE' },
    session: { subject: 'boss' },
  })
  const error = await rejection(() =>
    w.permissions.editPermission('p-*', { isActive: false } as never)
  )
  assertEquals(error.code, IAM_ERROR_CODES.lastAdministrator)
  await w.permissions.editPermission('p-*', { name: 'Renamed' } as never)
})

Deno.test('with a second administrator, the first can step down; the second is then the last', async () => {
  const w = solo({
    accounts: [holder('solo', ['role-manager']), holder('second', ['role-manager'])],
    profiles: { 'user-solo': 'ACTIVE', 'user-second': 'ACTIVE' },
  })
  await w.users.deactivateOwnAccount()
  assertEquals(w.state.profiles['user-solo'], 'INACTIVE')
  const next = solo({
    accounts: [holder('solo', ['role-manager']), holder('second', ['role-manager'])],
    profiles: { 'user-solo': 'INACTIVE', 'user-second': 'ACTIVE' },
    session: { subject: 'second' },
  })
  const error = await rejection(() => next.users.deactivateOwnAccount())
  assertEquals(error.code, IAM_ERROR_CODES.lastAdministrator)
})

Deno.test('changing another account roles never ends in LAST_ADMINISTRATOR for a caller that is an administrator itself', async () => {
  const w = solo({
    accounts: [holder('solo', ['role-manager']), holder('other', ['role-manager'])],
    profiles: { 'user-solo': 'ACTIVE', 'user-other': 'ACTIVE' },
  })
  await w.roles.removeRoles({ authId: 'other', roleIds: ['role-manager'] } as never)
  assertEquals(w.account('other')?.roleIds, [])
  assertEquals(w.account('solo')?.roleIds, ['role-manager'])
})
