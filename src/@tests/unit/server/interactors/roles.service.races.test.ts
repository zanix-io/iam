import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'

import { changeProtectingAdministrator } from 'server/interactors/role-admin.ts'
import { IAM_ERROR_CODES, RBAC_PERMISSIONS } from 'utils/constants.ts'
import {
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
 * Concurrency of "an administrator remains". Each path that can remove the last administrator is
 * checked before it writes and counted again after: here a concurrent request (simulated by the
 * world's hooks) takes the OTHER administrator away right between the check and the recount, and
 * the write must be undone and refused. The caller `x` is an administrator (role-manager); `t` is
 * the other one. Real concurrent HTTP requests are in `functional/e2e/concurrency.test.ts`.
 */
const P = RBAC_PERMISSIONS
const MANAGER = role('role-manager', [
  perm(ROLE_WRITE),
  perm(P.permissionWrite),
  perm(P.userWrite),
  perm('web:user'),
])
const EXTRA = role('role-extra', [perm(ROLE_WRITE)])
const holder = (id: string, roleIds: string[]): FakeAccount => ({
  id,
  userId: `user-${id}`,
  roleIds,
})
const PROFILES = { 'user-x': 'ACTIVE', 'user-t': 'ACTIVE' }

const pair = (extra: WorldInit = {}) =>
  buildWorld({
    roles: [MANAGER, ROOT_ROLE, USER_ROLE, EXTRA],
    accounts: [holder('x', ['role-manager']), holder('t', ['role-manager'])],
    profiles: PROFILES,
    session: { subject: 'x' },
    ...extra,
  })

type World = ReturnType<typeof buildWorld>
/** Runs `vanish` once, the first time `hook` fires. */
const once = (
  w: World,
  hook: 'beforeConditionalWrite' | 'afterWrite' | 'beforeRoleWrite',
  vanish: () => void,
) => {
  w.state[hook] = () => {
    w.state[hook] = undefined
    vanish()
  }
}

Deno.test('account roles: the caller is demoted right after the write, so the removal is undone', async () => {
  const w = pair()
  once(w, 'beforeConditionalWrite', () => w.setRolesDirectly('x', []))
  const error = await rejection(() =>
    w.roles.removeRoles({ authId: 't', roleIds: ['role-manager'] } as never)
  )
  assertEquals([error.status.value, error.code], [409, IAM_ERROR_CODES.lastAdministrator])
  assertEquals(w.account('t')?.roleIds, ['role-manager'])
})

Deno.test('editRole: the other administrator vanishes after the edit, so the permissions are restored', async () => {
  const w = pair({ accounts: [holder('x', ['role-manager']), holder('t', ['role-root'])] })
  once(w, 'afterWrite', () => w.setRolesDirectly('t', []))
  const error = await rejection(() =>
    w.roles.editRole('role-manager', { permissions: ['p-web:user'] } as never)
  )
  assertEquals(error.code, IAM_ERROR_CODES.lastAdministrator)
  assertEquals(w.roleById('role-manager').permissions.map((p) => p.code), [
    ROLE_WRITE,
    P.permissionWrite,
    P.userWrite,
    'web:user',
  ])
})

Deno.test('deleteRole: the only administrator vanishes around the delete, so the role is put back', async () => {
  // role-extra carries role-write and nobody holds it, so deleting it is allowed; then the caller,
  // the only administrator, is demoted before the recount.
  const w = pair({ accounts: [holder('x', ['role-manager'])] })
  once(w, 'afterWrite', () => w.setRolesDirectly('x', []))
  const error = await rejection(() => w.roles.deleteRole('role-extra'))
  assertEquals(error.code, IAM_ERROR_CODES.lastAdministrator)
  assertEquals(w.state.restoredRoles.length, 1)
  assertEquals(w.state.roles.some((r) => r.id === 'role-extra'), true)
})

Deno.test('deleteRole stays protected against a concurrent reassignment: the role cannot be deleted from under the account that just took it', async () => {
  // x holds role-manager. Another request gives x role-extra and takes role-manager away; between
  // deleteRole's check ("nobody holds role-extra") and its delete, both land. Each request passed
  // its own check; only the recount after the delete sees x holding nothing.
  const w = pair({ accounts: [holder('x', ['role-manager'])] })
  once(w, 'afterWrite', () => w.setRolesDirectly('x', ['role-extra']))
  // After the delete lands, x holds only the role that no longer exists.
  const error = await rejection(() => w.roles.deleteRole('role-extra'))
  assertEquals(error.code, IAM_ERROR_CODES.lastAdministrator)
  assertEquals(w.state.roles.some((r) => r.id === 'role-extra'), true, 'the role is back')
})

Deno.test('user status: the other administrator vanishes after the block, so the status is restored', async () => {
  const w = pair({ accounts: [holder('x', ['role-manager']), holder('t', ['role-root'])] })
  once(w, 'afterWrite', () => w.setRolesDirectly('t', []))
  const error = await rejection(() =>
    w.users.updateUserById('user-x', { status: 'INACTIVE' } as never)
  )
  assertEquals(error.code, IAM_ERROR_CODES.lastAdministrator)
  assertEquals(w.state.profiles['user-x'], 'ACTIVE')
})

Deno.test('own account: deleting it while the other administrator vanishes restores the status', async () => {
  const w = pair({ accounts: [holder('x', ['role-manager']), holder('t', ['role-root'])] })
  once(w, 'afterWrite', () => w.setRolesDirectly('t', []))
  await assertRejects(() => w.users.deleteOwnAccount(), HttpError)
  assertEquals(w.state.profiles['user-x'], 'ACTIVE')
})

Deno.test('permissions: the other administrator vanishes after the deactivation, so the permission is turned back on', async () => {
  const w = pair({ accounts: [holder('x', ['role-manager']), holder('t', ['role-root'])] })
  once(w, 'afterWrite', () => w.setRolesDirectly('t', []))
  const error = await rejection(() =>
    w.permissions.editPermission(`p-${ROLE_WRITE}`, { isActive: false } as never)
  )
  assertEquals(error.code, IAM_ERROR_CODES.lastAdministrator)
  assertEquals(w.roleById('role-manager').permissions[0].isActive, true)
})

Deno.test('across paths: a status block and a role removal that each leave the other administrator are not both honoured', async () => {
  const blockFirst = pair()
  once(blockFirst, 'afterWrite', () => blockFirst.setRolesDirectly('x', []))
  await assertRejects(
    () => blockFirst.users.updateUserById('user-t', { status: 'INACTIVE' } as never),
    HttpError,
  )
  assertEquals(blockFirst.state.profiles['user-t'], 'ACTIVE')

  const removeFirst = pair()
  once(removeFirst, 'beforeConditionalWrite', () => {
    removeFirst.state.profiles['user-x'] = 'INACTIVE'
  })
  await assertRejects(
    () => removeFirst.roles.removeRoles({ authId: 't', roleIds: ['role-manager'] } as never),
    HttpError,
  )
  assertEquals(removeFirst.account('t')?.roleIds, ['role-manager'])
})

Deno.test('an undo that cannot be applied is reported as such, not as a refused change', async () => {
  const w = pair()
  let conditionalWrites = 0
  w.state.beforeConditionalWrite = () => {
    conditionalWrites++
    if (conditionalWrites === 1) w.setRolesDirectly('x', [])
    // Every undo finds `t` changed again, so it cannot put the role back.
    if (conditionalWrites > 1) w.setRolesDirectly('t', [`role-other-${conditionalWrites}`])
  }
  const error = await rejection(() =>
    w.roles.removeRoles({ authId: 't', roleIds: ['role-manager'] } as never)
  )
  assertEquals(error.status.value, 500)
  assertEquals(error.code, IAM_ERROR_CODES.lastAdministratorUndoFailed)
  assertEquals(conditionalWrites, 4, 'one write and three undo attempts')
  assertEquals(w.state.audit[0].result, 'error')
  assertEquals(w.state.audit[0].reason, IAM_ERROR_CODES.lastAdministratorUndoFailed)
})

Deno.test('an undo that fails while someone else restored an administrator leaves the change standing', async () => {
  const w = pair()
  let conditionalWrites = 0
  w.state.beforeConditionalWrite = () => {
    conditionalWrites++
    if (conditionalWrites === 1) w.setRolesDirectly('x', [])
    if (conditionalWrites === 2) {
      // The undo finds `t` changed, but an administrator is back in the meantime.
      w.setRolesDirectly('t', ['role-extra'])
      w.setRolesDirectly('x', ['role-root'])
    }
  }
  const result = await w.roles.removeRoles({ authId: 't', roleIds: ['role-manager'] } as never)
  assertEquals(result.roleIds, [])
  assertEquals(conditionalWrites, 2)
})

Deno.test('changeProtectingAdministrator: a write that reports a changed target writes nothing and is not an error', async () => {
  const w = pair()
  let undone = false
  const written = await changeProtectingAdministrator(
    w.providers as never,
    { kind: 'user-blocked', userId: 'user-nobody' },
    { write: () => Promise.resolve(false), undo: () => Promise.resolve(undone = true) },
  )
  assertEquals([written, undone], [false, false])
})

Deno.test('add never retries and never fails for a concurrent change: it is a single atomic add', async () => {
  const w = pair({ accounts: [holder('x', ['role-manager']), holder('t', ['role-user'])] })
  w.state.beforeConditionalWrite = () => {
    throw new Error('[test] add must not use a conditional write')
  }
  w.setRolesDirectly('t', ['role-user', 'role-manager'])
  const result = await w.roles.addRoles({ authId: 't', roleIds: ['role-extra'] } as never)
  assertEquals(result.roleIds, ['role-user', 'role-manager', 'role-extra'])
  assertEquals(w.state.writes.map((write) => write[0]), ['add'])
})

Deno.test('editRole: a concurrent edit between the read and the write makes a permissions change fail with ROLE_VERSION_CONFLICT, with or without a version sent', async () => {
  for (const sendVersion of [false, true]) {
    const w = pair({ accounts: [holder('x', ['role-manager']), holder('t', ['role-root'])] })
    const read = w.roleById('role-user').updatedAt as Date
    // Someone else edits the role after it was read and before this request writes.
    once(w, 'beforeRoleWrite', () => {
      w.roleById('role-user').updatedAt = new Date(read.getTime() + 5000)
    })
    // deno-lint-ignore no-await-in-loop
    const error = await rejection(() =>
      w.roles.editRole('role-user', {
        permissions: ['p-web:user', `p-${P.userWrite}`],
        ...(sendVersion ? { updatedAt: read.toISOString() } : {}),
      } as never)
    )
    assertEquals([error.status.value, error.code], [409, IAM_ERROR_CODES.roleVersionConflict])
    assertEquals(w.roleById('role-user').permissions.map((p) => p.code), ['web:user'])
    assertEquals(w.events('roles.edit')[0].reason, IAM_ERROR_CODES.roleVersionConflict)
  }
})

Deno.test('editRole: name and description alone, with no version sent, are last-wins even after a concurrent edit', async () => {
  const w = pair()
  const read = w.roleById('role-user').updatedAt as Date
  once(w, 'beforeRoleWrite', () => {
    w.roleById('role-user').updatedAt = new Date(read.getTime() + 5000)
  })
  await w.roles.editRole('role-user', { description: 'Mine wins' } as never)
  assertEquals(w.roleById('role-user').description, 'Mine wins')
})

Deno.test('a role stored with a repeated id can still be changed: the conditional writes compare the stored array', async () => {
  const w = pair({
    accounts: [
      holder('x', ['role-manager']),
      holder('t', ['role-user', 'role-user', 'role-extra']),
    ],
  })
  assertEquals(
    (await w.roles.removeRoles({ authId: 't', roleIds: ['role-extra'] } as never)).roleIds,
    ['role-user'],
  )
  assertEquals(w.account('t')?.roleIds, ['role-user', 'role-user'])
  // Replacing it (assign / PUT) works too, and leaves no repeat behind.
  w.setRolesDirectly('t', ['role-user', 'role-user'])
  await w.roles.setRoles('t', ['role-user', 'role-extra'])
  assertEquals(w.account('t')?.roleIds, ['role-user', 'role-extra'])
  // And removing a repeated role takes every copy.
  w.setRolesDirectly('t', ['role-user', 'role-user', 'role-extra'])
  await w.roles.removeRoles({ authId: 't', roleIds: ['role-user'] } as never)
  assertEquals(w.account('t')?.roleIds, ['role-extra'])
})
