import { assertEquals } from 'jsr:@std/assert@0.224'

import { IAM_ERROR_CODES, RBAC_PERMISSIONS } from 'utils/constants.ts'
import { buildWorld, perm, rejection, role } from '../../helpers/role-world.ts'

/**
 * Turning a permission on or off grants or takes it away from every role that carries it, so
 * `PermissionsService.editPermission` applies "grant only what you hold" to `isActive` in both
 * directions; edits that do not change what is granted do not need it.
 */

const SENSITIVE = 'orders:refund'
const roles = [
  role('role-refunds', [perm(SENSITIVE, false)]),
  role('role-live', [perm('web:user')]),
]
const PERMISSION_WRITE = RBAC_PERMISSIONS.permissionWrite
const SCOPED = { subject: 'svc', scope: [PERMISSION_WRITE, 'web:user'] }
const ROOT = { subject: 'svc', scope: ['*'] }

Deno.test('reactivating an inactive permission the caller does not hold is FORBIDDEN', async () => {
  const w = buildWorld({ roles, session: SCOPED })
  const error = await rejection(() =>
    w.permissions.editPermission(`p-${SENSITIVE}`, { isActive: true } as never)
  )
  assertEquals([error.status.value, error.code], [403, IAM_ERROR_CODES.roleGrantExceedsScope])
  assertEquals(error.meta, { missing: [SENSITIVE] })
  assertEquals(w.state.updatedPermissions.length, 0)
})

Deno.test('deactivating a permission the caller does not hold is FORBIDDEN', async () => {
  const w = buildWorld({ roles: [role('role-refunds', [perm(SENSITIVE)])], session: SCOPED })
  const error = await rejection(() =>
    w.permissions.editPermission(`p-${SENSITIVE}`, { isActive: false } as never)
  )
  assertEquals(error.code, IAM_ERROR_CODES.roleGrantExceedsScope)
  assertEquals(w.state.updatedPermissions.length, 0)
})

Deno.test('a holder of the permission can turn it on and off, and so can *', async () => {
  const holder = buildWorld({
    roles,
    session: { subject: 'svc', scope: ['web:user', SENSITIVE, PERMISSION_WRITE] },
  })
  await holder.permissions.editPermission(`p-${SENSITIVE}`, { isActive: true } as never)
  await holder.permissions.editPermission(`p-${SENSITIVE}`, { isActive: false } as never)
  assertEquals(holder.state.updatedPermissions.length, 2)

  const root = buildWorld({ roles, session: ROOT })
  await root.permissions.editPermission(`p-${SENSITIVE}`, { isActive: true } as never)
  assertEquals(root.state.updatedPermissions.length, 1)
})

Deno.test('editing the name, description or categories needs no permission, nor does repeating isActive', async () => {
  const w = buildWorld({ roles, session: { subject: 'svc', scope: [PERMISSION_WRITE] } })
  await w.permissions.editPermission(`p-${SENSITIVE}`, {
    name: 'Refunds',
    description: 'Refund orders',
    categories: ['orders'],
  } as never)
  // `isActive` already is false: nothing is granted or taken away.
  await w.permissions.editPermission(`p-${SENSITIVE}`, { isActive: false } as never)
  assertEquals(w.state.updatedPermissions.length, 2)
})

Deno.test('the caller is read from the database: a demoted administrator cannot toggle a permission', async () => {
  const w = buildWorld({
    roles,
    accounts: [{ id: 'svc', userId: 'user-svc', roleIds: [] }],
    profiles: { 'user-svc': 'ACTIVE' },
    session: ROOT,
  })
  // Its token still says `*`, its roles say nothing: it no longer holds permission-write.
  const error = await rejection(() =>
    w.permissions.editPermission(`p-${SENSITIVE}`, { isActive: true } as never)
  )
  assertEquals([error.status.value, error.code], [403, IAM_ERROR_CODES.actorLacksPermission])
  assertEquals(error.meta, { required: PERMISSION_WRITE })
  assertEquals(w.state.updatedPermissions.length, 0)
})

Deno.test('editPermission with the version read applies; a stale version is a 409 with its code', async () => {
  const w = buildWorld({ roles, session: ROOT })
  const version = '2026-01-01T00:00:00.000Z'
  await w.permissions.editPermission('p-web:user', { name: 'First', updatedAt: version } as never)
  const error = await rejection(() =>
    w.permissions.editPermission('p-web:user', { name: 'Second', updatedAt: version } as never)
  )
  assertEquals([error.status.value, error.code], [409, IAM_ERROR_CODES.permissionVersionConflict])
  // Without a version the last edit wins.
  await w.permissions.editPermission('p-web:user', { name: 'Third' } as never)
  assertEquals(w.state.updatedPermissions.length, 2)
})
