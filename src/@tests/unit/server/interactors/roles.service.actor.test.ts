import { assert, assertEquals } from 'jsr:@std/assert@0.224'

import { IAM_ERROR_CODES, RBAC_PERMISSIONS } from 'utils/constants.ts'
import { buildWorld, rejection } from '../../helpers/role-world.ts'

/**
 * Who the caller is for every administration operation. The caller is an ACCOUNT, read from the
 * database after the route's guard passed: it must exist, be able to sign in, and still hold the
 * administrative permission of the route (`role-write`, `permission-write` or `user-write`) with the
 * roles it holds NOW, whatever its token still says. A service credential (`api` session) is never
 * a caller, `*` included.
 */

const P = RBAC_PERMISSIONS
const account = (id: string, roleIds: string[]) => ({ id, userId: `user-${id}`, roleIds })
const target = account('target', [])
const BODY = { name: 'N', code: 'new', description: 'D', permissions: [] }

/** Every administration operation, as a thunk over a world, with the permission it asks for. */
const OPERATIONS = (w: ReturnType<typeof buildWorld>) =>
  [
    ['assign', P.roleWrite, () =>
      w.roles.assignRole({ authId: 'target', roleId: 'role-user' } as never)],
    ['add', P.roleWrite, () =>
      w.roles.addRoles({ authId: 'target', roleIds: ['role-user'] } as never)],
    ['remove', P.roleWrite, () =>
      w.roles.removeRoles({ authId: 'target', roleIds: ['role-user'] } as never)],
    ['set', P.roleWrite, () =>
      w.roles.setRoles('target', ['role-user'])],
    ['createRole', P.roleWrite, () =>
      w.roles.createRole(BODY as never)],
    ['editRole', P.roleWrite, () =>
      w.roles.editRole('role-user', { description: 'Renamed' } as never)],
    ['editRole permissions', P.roleWrite, () =>
      w.roles.editRole('role-user', { permissions: ['p-web:user'] } as never)],
    ['deleteRole', P.roleWrite, () =>
      w.roles.deleteRole('role-seller')],
    ['createPermission', P.permissionWrite, () =>
      w.permissions.createPermission({ code: 'a:b', name: 'n', description: 'd' } as never)],
    ['editPermission', P.permissionWrite, () =>
      w.permissions.editPermission('p-web:user', { name: 'n' } as never)],
    ['deactivate permission', P.permissionWrite, () =>
      w.permissions.editPermission('p-web:user', { isActive: false } as never)],
    ['edit user', P.userWrite, () =>
      w.users.updateUserById('user-target', { firstName: 'J' } as never)],
    ['block user', P.userWrite, () =>
      w.users.updateUserById('user-target', { status: 'INACTIVE' } as never)],
    ['register user', P.userWrite, () =>
      w.users.registerUser({ email: 'x@y.z' } as never)],
  ] as const

const code = (error: { code?: string }) => error.code

Deno.test('an api session is refused by every administration operation, wildcard scope included, leaving no change and an audit event', async () => {
  const w = buildWorld({
    accounts: [target],
    profiles: { 'user-target': 'ACTIVE' },
    session: { subject: 'service-credential', scope: ['*'], type: 'api' },
  })
  for (const [name, , run] of OPERATIONS(w)) {
    // deno-lint-ignore no-await-in-loop
    const error = await rejection(run)
    assertEquals([error.status.value, code(error)], [403, IAM_ERROR_CODES.actorNotAccount], name)
  }
  assertEquals(
    [w.state.writes.length, w.state.created.length, w.state.deletedRoles.length],
    [0, 0, 0],
  )
  assertEquals(w.state.updatedUsers.length + w.state.updatedPermissions.length, 0)
  // The refusals of the audited operations are on the trail (registering is not audited).
  assert(w.state.audit.length >= 12)
  assertEquals(new Set(w.state.audit.map((event) => event.result)), new Set(['denied']))
  assertEquals(
    new Set(w.state.audit.map((event) => event.reason)),
    new Set([IAM_ERROR_CODES.actorNotAccount]),
  )
})

Deno.test('a user session whose subject is a service name, not an account id, is ACTOR_NOT_ACCOUNT rather than a failure', async () => {
  const w = buildWorld({
    accounts: [target],
    session: { subject: 'not-an-object-id-service', scope: ['*'], missing: true },
  })
  for (const [name, , run] of OPERATIONS(w)) {
    // deno-lint-ignore no-await-in-loop
    const error = await rejection(run)
    assertEquals([error.status.value, code(error)], [403, IAM_ERROR_CODES.actorNotAccount], name)
  }
})

Deno.test('a user session whose account is gone is refused, whatever its token still says', async () => {
  const w = buildWorld({
    accounts: [target],
    profiles: { 'user-target': 'ACTIVE' },
    session: { subject: 'deleted-admin', scope: ['*'], missing: true },
  })
  for (const [name, , run] of OPERATIONS(w)) {
    // deno-lint-ignore no-await-in-loop
    const error = await rejection(run)
    assertEquals([error.status.value, code(error)], [403, IAM_ERROR_CODES.actorNotActive], name)
  }
  assertEquals(w.state.writes.length + w.state.created.length + w.state.deletedRoles.length, 0)
})

Deno.test('an account whose profile is inactive or deleted is refused too', async () => {
  for (const status of ['INACTIVE', 'DELETED']) {
    const w = buildWorld({
      accounts: [account('caller', ['role-root']), target],
      profiles: { 'user-caller': status, 'user-target': 'ACTIVE' },
      session: { subject: 'caller' },
    })
    for (const [name, , run] of OPERATIONS(w)) {
      // deno-lint-ignore no-await-in-loop
      const error = await rejection(run)
      assertEquals([error.status.value, code(error)], [403, IAM_ERROR_CODES.actorNotActive], name)
    }
  }
})

Deno.test('a caller must still hold the permission of the route: each operation names the one it needs', async () => {
  // The caller holds the other two administrative permissions and nothing of the route's own.
  for (const [name, required] of OPERATIONS(buildWorld())) {
    const others = [P.roleWrite, P.permissionWrite, P.userWrite].filter((p) => p !== required)
    const w = buildWorld({
      accounts: [target],
      profiles: { 'user-target': 'ACTIVE' },
      session: { subject: 'caller', scope: others },
    })
    const run = (OPERATIONS(w).find(([entry]) => entry === name) ?? [])[2] as () => Promise<unknown>
    // deno-lint-ignore no-await-in-loop
    const error = await rejection(run)
    assertEquals(
      [error.status.value, code(error)],
      [403, IAM_ERROR_CODES.actorLacksPermission],
      name,
    )
    assertEquals(error.meta, { required }, name)
    assertEquals(w.state.writes.length + w.state.created.length + w.state.deletedRoles.length, 0)
  }
})

Deno.test('a demoted administrator with a live token holds nothing: it cannot even rename a role or create an empty one', async () => {
  const w = buildWorld({
    accounts: [account('caller', []), target],
    profiles: { 'user-caller': 'ACTIVE', 'user-target': 'ACTIVE' },
    session: { subject: 'caller', scope: ['*'] },
  })
  for (const [name, , run] of OPERATIONS(w)) {
    // deno-lint-ignore no-await-in-loop
    const error = await rejection(run)
    assertEquals(code(error), IAM_ERROR_CODES.actorLacksPermission, name)
  }
})

Deno.test('holding the route permission is enough for what asks to grant nothing, and * covers every route', async () => {
  const holder = buildWorld({
    accounts: [target],
    session: { subject: 'caller', scope: [P.roleWrite] },
  })
  await holder.roles.editRole('role-user', { description: 'Renamed' } as never)
  await holder.roles.createRole(BODY as never)
  assertEquals([holder.state.updatedRoles.length, holder.state.created.length], [1, 1])
  const root = buildWorld({
    accounts: [target],
    profiles: { 'user-target': 'ACTIVE' },
    session: { subject: 'caller', scope: ['*'] },
  })
  // `*` passes the permission check on every route (the operations may still fail on their own terms).
  for (const [name, , run] of OPERATIONS(root)) {
    // deno-lint-ignore no-await-in-loop
    const error = await run().then(() => undefined, (rejected) => rejected)
    assertEquals(code(error ?? {}) === IAM_ERROR_CODES.actorLacksPermission, false, name)
  }
})

Deno.test('a promoted account acts with what it now holds, though its token says nothing', async () => {
  const w = buildWorld({
    accounts: [account('caller', ['role-root']), target],
    profiles: { 'user-caller': 'ACTIVE' },
    session: { subject: 'caller', scope: [] },
  })
  await w.roles.addRoles({ authId: 'target', roleIds: ['role-root'] } as never)
  assertEquals(w.account('target')?.roleIds, ['role-root'])
})

Deno.test('the caller holds what its roles grant today, union included', async () => {
  const w = buildWorld({
    accounts: [account('caller', ['role-admin', 'role-seller']), target],
    profiles: { 'user-caller': 'ACTIVE' },
    session: { subject: 'caller', scope: ['*'] },
  })
  // role-admin and role-seller together cover role-user (web:user) and role-seller itself.
  await w.roles.addRoles({ authId: 'target', roleIds: ['role-user', 'role-seller'] } as never)
  const error = await rejection(() =>
    w.roles.addRoles({ authId: 'target', roleIds: ['role-root'] } as never)
  )
  assertEquals(error.meta, { missing: ['*'] })
})

Deno.test('a deactivated permission no longer counts for the caller', async () => {
  const w = buildWorld({
    accounts: [account('caller', ['role-admin']), target],
    profiles: { 'user-caller': 'ACTIVE' },
    session: { subject: 'caller', scope: ['*'] },
  })
  await w.roles.addRoles({ authId: 'target', roleIds: ['role-user'] } as never)
  // role-write, the only permission that lets the caller change roles, is turned off.
  w.roleById('role-admin').permissions[0].isActive = false
  const error = await rejection(() =>
    w.roles.addRoles({ authId: 'target', roleIds: ['role-seller'] } as never)
  )
  assertEquals(code(error), IAM_ERROR_CODES.actorLacksPermission)
})

Deno.test('the caller is read from the database once per operation, with the roles being changed', async () => {
  const w = buildWorld({
    accounts: [account('caller', ['role-root']), target],
    profiles: { 'user-caller': 'ACTIVE' },
    session: { subject: 'caller', scope: [] },
  })
  await w.roles.addRoles({ authId: 'target', roleIds: ['role-seller'] } as never)
  assertEquals(w.state.findRoleQueries, [['role-root', 'role-seller']])
})

Deno.test('an api session is refused by every administration operation even when its subject is a real account id with every permission', async () => {
  // The type check of the caller, on its own: the subject IS an existing account that holds `*`,
  // so nothing but the session type can refuse it. (Without that check each call below succeeds.)
  const w = buildWorld({
    accounts: [account('admin', ['role-root']), target],
    profiles: { 'user-admin': 'ACTIVE', 'user-target': 'ACTIVE' },
    session: { subject: 'admin', scope: ['*'], type: 'api' },
  })
  for (const [name, , run] of OPERATIONS(w)) {
    // deno-lint-ignore no-await-in-loop
    const error = await rejection(run)
    assertEquals([error.status.value, code(error)], [403, IAM_ERROR_CODES.actorNotAccount], name)
  }
  assertEquals(
    [w.state.writes.length, w.state.created.length, w.state.deletedRoles.length],
    [0, 0, 0],
  )
  assertEquals(w.state.updatedUsers.length + w.state.updatedPermissions.length, 0)
  // The same account as a `user` session is not refused by the type check: the first operation
  // (an assign) goes through.
  const asUser = buildWorld({
    accounts: [account('admin', ['role-root']), target],
    profiles: { 'user-admin': 'ACTIVE', 'user-target': 'ACTIVE' },
    session: { subject: 'admin', scope: ['*'], type: 'user' },
  })
  await asUser.roles.assignRole({ authId: 'target', roleId: 'role-user' } as never)
  assertEquals(asUser.account('target')?.roleIds, ['role-user'])
})
