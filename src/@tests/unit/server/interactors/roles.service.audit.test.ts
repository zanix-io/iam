import '@zanix/server'
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'

import { AuditRepository } from 'server/repositories/audit/entity.provider.ts'
import { IAM_ERROR_CODES, RBAC_PERMISSIONS } from 'utils/constants.ts'
import { buildWorld, perm, rejection, role, ROLE_WRITE } from '../../helpers/role-world.ts'

/**
 * The audit trail: every mutation of roles, permissions and account status is written, as
 * `pending` before it changes anything and closed with its outcome after, rejected attempts
 * included (whatever the reason: a security rule, a missing record, a caller that is not an active
 * account), and the trail fails closed.
 */

const P = RBAC_PERMISSIONS
const ROOT = { subject: 'caller', scope: ['*'] }
const holder = (id: string, roleIds: string[]) => ({ id, userId: `user-${id}`, roleIds })
const MANAGER = role('role-manager', [perm(ROLE_WRITE), perm(P.userWrite), perm(P.permissionWrite)])

Deno.test('a successful change is recorded with who, what, the request, before and after', async () => {
  const w = buildWorld({ accounts: [holder('auth-1', ['role-user'])], session: ROOT })
  await w.roles.addRoles({ authId: 'auth-1', roleIds: ['role-seller'] } as never)
  const [event] = w.events('roles.add')
  assertEquals(w.state.audit.length, 1)
  assertEquals([event.actor, event.actorType], ['caller', 'user'])
  assertEquals(event.target, { kind: 'account', id: 'auth-1' })
  assertEquals(event.result, 'ok')
  assertEquals(event.requestId, 'req-1')
  assertEquals(event.request, { mode: 'add', roleIds: ['role-seller'] })
  assertEquals(event.before, { roleIds: ['role-user'] })
  assertEquals(event.after, { roleIds: ['role-user', 'role-seller'] })
})

Deno.test('the event is pending while the change is written, so no change is left without a trace', async () => {
  const w = buildWorld({ accounts: [holder('auth-1', ['role-user'])], session: ROOT })
  const seen: unknown[] = []
  w.state.beforeConditionalWrite = () => seen.push(w.state.audit.map((event) => event.result))
  await w.roles.removeRoles({ authId: 'auth-1', roleIds: ['role-user'] } as never)
  assertEquals(seen, [['pending']])
  assertEquals(w.state.audit[0].result, 'ok')
})

Deno.test('editing a role keeps what was asked (name, description, permissions) apart from before and after', async () => {
  const w = buildWorld({ session: ROOT })
  await w.roles.editRole('role-user', {
    name: 'Renamed',
    description: 'New text',
    permissions: ['p-web:user', 'p-seller:manage'],
  } as never)
  const [event] = w.events('roles.edit')
  assertEquals(event.request, {
    name: 'Renamed',
    description: 'New text',
    permissions: ['p-web:user', 'p-seller:manage'],
  })
  assertEquals(event.before, { permissions: ['p-web:user'] })
  assertEquals(event.after, { permissions: ['p-web:user', 'p-seller:manage'] })
})

Deno.test('creating a role or a permission records the id it got, once it exists', async () => {
  const w = buildWorld({ session: ROOT })
  await w.roles.createRole({ name: 'New', code: 'new', description: 'D', permissions: [] } as never)
  await w.permissions.createPermission({ code: 'shop:new', name: 'n', description: 'd' } as never)
  assertEquals((w.events('roles.create')[0].target as { id: string }).id, 'role-new-1')
  assertEquals((w.events('permissions.create')[0].target as { id: string }).id, 'p-new-1')
})

Deno.test('every rejection is recorded, whatever its reason, for every kind of operation', async () => {
  // The caller is the only administrator, so its own account is both reachable and protected.
  const solo = buildWorld({
    roles: [MANAGER],
    accounts: [holder('solo', ['role-manager']), holder('other', [])],
    profiles: { 'user-solo': 'ACTIVE', 'user-other': 'ACTIVE' },
    session: { subject: 'solo' },
  })
  const cases: [string, () => Promise<unknown>, string, string][] = [
    // [action, call, result, reason]
    [
      'users.deactivate-own',
      () => solo.users.deactivateOwnAccount(),
      'conflict',
      IAM_ERROR_CODES.lastAdministrator,
    ],
    [
      'users.delete-own',
      () => solo.users.deleteOwnAccount(),
      'conflict',
      IAM_ERROR_CODES.lastAdministrator,
    ],
    [
      'users.block',
      () => solo.users.updateUserById('user-solo', { status: 'INACTIVE' } as never),
      'conflict',
      IAM_ERROR_CODES.lastAdministrator,
    ],
    [
      'users.edit',
      () => solo.users.updateUserById('user-missing', { firstName: 'J' } as never),
      'error',
      'NOT_FOUND',
    ],
    [
      'users.block',
      () => solo.users.updateUserById('user-missing', { status: 'DELETED' } as never),
      'error',
      'NOT_FOUND',
    ],
    [
      'roles.add',
      () => solo.roles.addRoles({ authId: 'solo', roleIds: ['role-manager'] } as never),
      'denied',
      IAM_ERROR_CODES.roleSelfChange,
    ],
    [
      'roles.add',
      () => solo.roles.addRoles({ authId: 'other', roleIds: ['missing'] } as never),
      'error',
      'NOT_FOUND',
    ],
    [
      'permissions.edit',
      () => solo.permissions.editPermission('missing', { name: 'n' } as never),
      'error',
      'NOT_FOUND',
    ],
    ['roles.delete', () => solo.roles.deleteRole('missing'), 'error', 'NOT_FOUND'],
    [
      'roles.edit',
      () => solo.roles.editRole('role-manager', { permissions: ['p-web:user'] } as never),
      'error',
      'BAD_REQUEST',
    ],
  ]
  for (const [action, call, result, reason] of cases) {
    const before = solo.events(action).length
    // deno-lint-ignore no-await-in-loop
    await rejection(call)
    const events = solo.events(action)
    assertEquals(events.length, before + 1, `${action} (${reason}) left no event`)
    const last = events[events.length - 1]
    assertEquals(
      [last.result, last.reason, last.actor],
      [result, reason, 'solo'],
      `${action} ${reason}`,
    )
  }
})

Deno.test('the rejections of a user-write caller are on the trail too: not covered, not active, lacking the permission', async () => {
  const covered = buildWorld({
    accounts: [holder('boss', ['role-root']), holder('clerk', ['role-clerk'])],
    roles: [role('role-root', [perm('*')]), role('role-clerk', [perm(P.userWrite)])],
    profiles: { 'user-boss': 'ACTIVE', 'user-clerk': 'ACTIVE' },
    session: { subject: 'clerk' },
  })
  const exceeds = await rejection(() =>
    covered.users.updateUserById('user-boss', { status: 'INACTIVE' } as never)
  )
  assertEquals(exceeds.code, IAM_ERROR_CODES.roleGrantExceedsScope)

  const gone = buildWorld({
    accounts: [holder('boss', ['role-root'])],
    profiles: { 'user-boss': 'ACTIVE' },
    session: { subject: 'ghost', missing: true },
  })
  const notActive = await rejection(() =>
    gone.users.updateUserById('user-boss', { status: 'INACTIVE' } as never)
  )
  assertEquals(notActive.code, IAM_ERROR_CODES.actorNotActive)

  const lacking = buildWorld({
    accounts: [holder('boss', ['role-root'])],
    profiles: { 'user-boss': 'ACTIVE' },
    session: { subject: 'caller', scope: [P.roleRead] },
  })
  const noPermission = await rejection(() =>
    lacking.users.updateUserById('user-boss', { firstName: 'J' } as never)
  )
  assertEquals(noPermission.code, IAM_ERROR_CODES.actorLacksPermission)

  assertEquals(
    [covered, gone, lacking].map((
      w,
    ) => [w.state.audit[0].action, w.state.audit[0].result, w.state.audit[0].reason]),
    [
      ['users.block', 'denied', 'ROLE_GRANT_EXCEEDS_SCOPE'],
      ['users.block', 'denied', 'ACTOR_NOT_ACTIVE'],
      ['users.edit', 'denied', 'ACTOR_LACKS_PERMISSION'],
    ],
  )
})

Deno.test('every kind of mutation is audited, with its target', async () => {
  const w = buildWorld({
    accounts: [holder('auth-1', ['role-user']), holder('auth-2', ['role-root'])],
    profiles: { 'user-auth-1': 'ACTIVE', 'user-auth-2': 'ACTIVE' },
    session: ROOT,
  })
  await w.roles.createRole({ name: 'N', code: 'new', description: 'D', permissions: [] } as never)
  await w.roles.editRole('role-seller', { name: 'Renamed' } as never)
  await w.roles.deleteRole('role-seller')
  await w.roles.assignRole({ authId: 'auth-1', roleId: 'role-root' } as never)
  await w.roles.setRoles('auth-1', ['role-user'])
  await w.permissions.createPermission({ code: 'shop:x', name: 'n', description: 'd' } as never)
  await w.permissions.editPermission('p-web:user', { name: 'Renamed' } as never)
  await w.users.updateUserById('user-auth-1', { firstName: 'Jane' } as never)
  await w.users.updateUserById('user-auth-1', { status: 'INACTIVE' } as never)
  assertEquals(
    w.state.audit.map((event) => [event.action, (event.target as { kind: string }).kind]),
    [
      ['roles.create', 'role'],
      ['roles.edit', 'role'],
      ['roles.delete', 'role'],
      ['roles.assign', 'account'],
      ['roles.set', 'account'],
      ['permissions.create', 'permission'],
      ['permissions.edit', 'permission'],
      ['users.edit', 'user'],
      ['users.block', 'user'],
    ],
  )
  assert(w.state.audit.every((event) => event.result === 'ok'))
})

Deno.test('the trail fails closed: if the event cannot be opened, nothing changes', async () => {
  const w = buildWorld({
    accounts: [holder('auth-1', ['role-user'])],
    session: ROOT,
    failAudit: true,
  })
  await assertRejects(
    () => w.roles.addRoles({ authId: 'auth-1', roleIds: ['role-seller'] } as never),
    Error,
    'audit store is down',
  )
  assertEquals(w.state.writes, [])
  await assertRejects(() => w.roles.deleteRole('role-seller'), Error, 'audit store is down')
  assertEquals(w.state.deletedRoles, [])
})

Deno.test('if the event cannot be closed, the operation stands, the failure is logged, and the event stays pending', async () => {
  const w = buildWorld({ accounts: [holder('auth-1', ['role-user'])], session: ROOT })
  const repository = w.providers.get(AuditRepository) as unknown as {
    finish: () => never
  }
  repository.finish = () => {
    throw new Error('[test] the audit store went away')
  }
  const lines: string[] = []
  const original = { log: console.log, error: console.error, info: console.info }
  console.log = console.error = console.info = (...args: unknown[]) =>
    void lines.push(args.join(' '))
  try {
    const result = await w.roles.addRoles({ authId: 'auth-1', roleIds: ['role-seller'] } as never)
    assertEquals(result.roleIds, ['role-user', 'role-seller'])
  } finally {
    Object.assign(console, original)
  }
  assertEquals(w.state.audit.map((event) => event.result), ['pending'])
  // `new HttpError(..., { shouldLog: true })` logs without being thrown (the logger is loaded here
  // by the `@zanix/server` import at the top, as it is in the running server).
  assert(lines.some((line) => line.includes('Could not close audit event')), lines.join('\n'))
})

Deno.test('events hold ids, codes and plain values only, never contact data or secrets', async () => {
  const w = buildWorld({ accounts: [holder('auth-1', ['role-user'])], session: ROOT })
  await w.roles.createRole({
    name: 'N',
    code: 'new',
    description: 'D',
    permissions: ['p-web:user'],
  } as never)
  await w.roles.addRoles({ authId: 'auth-1', roleIds: ['role-seller'] } as never)
  const text = JSON.stringify(w.state.audit)
  for (const forbidden of ['email', 'password', 'token', 'secret', 'phone']) {
    assert(!text.toLowerCase().includes(forbidden), `the trail must not contain "${forbidden}"`)
  }
})

Deno.test('AuditService: forwards the filters, parses the dates and refuses a bad range', async () => {
  const w = buildWorld({})
  const page = await w.audit.searchEvents({
    actor: 'auth-1',
    action: 'roles.add',
    result: 'denied',
    targetKind: 'account',
    targetId: 'auth-2',
    from: '2026-01-01',
    to: '2026-02-01T00:00:00Z',
    page: 2,
  }) as unknown as { options: Record<string, unknown> }
  assertEquals(page.options, {
    actor: 'auth-1',
    action: 'roles.add',
    result: 'denied',
    targetKind: 'account',
    targetId: 'auth-2',
    page: 2,
    from: new Date('2026-01-01'),
    to: new Date('2026-02-01T00:00:00Z'),
  })
  assertEquals(
    (await w.audit.searchEvents({}) as unknown as { options: unknown }).options,
    { from: undefined, to: undefined },
  )
  await assertRejects(
    () => w.audit.searchEvents({ from: '2026-03-01', to: '2026-02-01' }),
    HttpError,
    "'from' must not be after 'to'",
  )
  await assertRejects(
    () => w.audit.searchEvents({ from: '2026-13-45' }),
    HttpError,
    'not a valid date',
  )
})

Deno.test('AuditService: sortBy may only name the indexed fields', async () => {
  const w = buildWorld({})
  for (const sortBy of [{ createdAt: -1 }, { actor: 1 }, { action: 1, result: -1 }] as const) {
    // deno-lint-ignore no-await-in-loop
    const page = await w.audit.searchEvents({ sortBy: { ...sortBy } as never }) as unknown as {
      options: { sortBy: unknown }
    }
    assertEquals(page.options.sortBy, sortBy)
  }
  for (const sortBy of [{ before: 1 }, { 'target.id': 1 }, { createdAt: 1, request: -1 }]) {
    // deno-lint-ignore no-await-in-loop
    const error = await rejection(() => w.audit.searchEvents({ sortBy: sortBy as never }))
    assertEquals(error.status.value, 400)
  }
})
