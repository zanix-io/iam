import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'

import { RolesService } from 'server/interactors/roles.interactor.ts'
import { AuthRepository } from 'server/repositories/auth/entity.provider.ts'
import { PermissionsRepository } from 'server/repositories/permissions/entity.provider.ts'
import { RolesRepository } from 'server/repositories/roles/entity.provider.ts'
import { fn, mapGetter, mockAccessor } from '../../helpers/mock.ts'

const baseRole = (overrides: Record<string, unknown> = {}) => ({
  id: 'role-1',
  name: 'Support',
  code: 'support',
  description: 'Support role',
  permissions: ['perm-1'],
  ...overrides,
})

const baseAuth = (overrides: Record<string, unknown> = {}) => ({
  id: 'auth-1',
  email: 'jane@example.com',
  ...overrides,
})

const defaultRolesRepo = () => ({
  createRole: fn((..._args: unknown[]) => ({})),
  findById: fn((..._args: unknown[]): unknown => baseRole()),
  findByCode: fn((..._args: unknown[]): unknown => undefined),
  updateRole: fn((..._args: unknown[]) => ({})),
  deleteRole: fn((..._args: unknown[]) => ({})),
  searchRoles: fn((..._args: unknown[]) => ({ docs: [baseRole()], total: 1 })),
})

const defaultPermissionsRepo = () => ({
  findManyByIds: fn((ids: string[]): unknown => ids.map((id) => ({ id }))),
})

const defaultAuthRepo = () => ({
  findById: fn((..._args: unknown[]): unknown => baseAuth()),
  updateAuth: fn((..._args: unknown[]) => ({})),
})

function buildService(opts: {
  rolesRepo?: Partial<ReturnType<typeof defaultRolesRepo>>
  permissionsRepo?: Partial<ReturnType<typeof defaultPermissionsRepo>>
  authRepo?: Partial<ReturnType<typeof defaultAuthRepo>>
  session?: Record<string, unknown>
} = {}) {
  const rolesRepo = { ...defaultRolesRepo(), ...opts.rolesRepo }
  const permissionsRepo = { ...defaultPermissionsRepo(), ...opts.permissionsRepo }
  const authRepo = { ...defaultAuthRepo(), ...opts.authRepo }

  const service = new RolesService('ctx-1')
  mockAccessor(
    service,
    'providers',
    mapGetter([
      [RolesRepository, rolesRepo],
      [PermissionsRepository, permissionsRepo],
      [AuthRepository, authRepo],
    ]),
  )
  mockAccessor(service, 'context', { session: opts.session ?? { subject: 'admin-1' } })

  return { service, rolesRepo, permissionsRepo, authRepo }
}

Deno.test('createRole: throws CONFLICT when the code already exists', async () => {
  const { service } = buildService({ rolesRepo: { findByCode: fn(() => baseRole()) } })
  await assertRejects(
    () => service.createRole({ code: 'support', permissions: [] } as never),
    HttpError,
    'already exists',
  )
})

Deno.test('createRole: throws BAD_REQUEST when a referenced permission does not exist', async () => {
  const { service } = buildService({
    permissionsRepo: { findManyByIds: fn((_ids: string[]) => [{ id: 'perm-1' }]) },
  })
  await assertRejects(
    () =>
      service.createRole({
        code: 'support',
        name: 'Support',
        description: 'x',
        permissions: ['perm-1', 'perm-2'],
      } as never),
    HttpError,
    'do not exist',
  )
})

Deno.test('createRole: on success persists the role with the caller as createdBy', async () => {
  const { service, rolesRepo } = buildService()
  const result = await service.createRole({
    code: 'support',
    name: 'Support',
    description: 'x',
    permissions: ['perm-1'],
  } as never)
  assertEquals(result, { response: 'role created' })
  const created = rolesRepo.createRole.calls[0]?.[0] as Record<string, unknown>
  assertEquals(created.createdBy, 'admin-1')
})

Deno.test('createRole: with no tenantId, scopes the collision check to the global role', async () => {
  const { service, rolesRepo } = buildService()
  await service.createRole({
    code: 'support',
    name: 'Support',
    description: 'x',
    permissions: ['perm-1'],
  } as never)
  assertEquals(rolesRepo.findByCode.calls[0], ['support', undefined])
})

Deno.test('createRole: throws CONFLICT for the same code within the same tenant', async () => {
  const { service } = buildService({
    rolesRepo: {
      findByCode: fn((..._args: unknown[]): unknown => {
        const [, tenantId] = _args as [string, string | undefined]
        return tenantId === 'tenant-a' ? baseRole({ tenantId: 'tenant-a' }) : undefined
      }),
    },
  })
  await assertRejects(
    () =>
      service.createRole({
        code: 'support',
        name: 'Support',
        description: 'x',
        tenantId: 'tenant-a',
        permissions: [],
      } as never),
    HttpError,
    'already exists',
  )
})

Deno.test('createRole: the same code is allowed for a different tenant (cross-tenant, no collision)', async () => {
  const { service, rolesRepo } = buildService({
    rolesRepo: {
      findByCode: fn((..._args: unknown[]): unknown => {
        const [, tenantId] = _args as [string, string | undefined]
        return tenantId === 'tenant-a' ? baseRole({ tenantId: 'tenant-a' }) : undefined
      }),
    },
  })
  const result = await service.createRole({
    code: 'support',
    name: 'Support',
    description: 'x',
    tenantId: 'tenant-b',
    permissions: [],
  } as never)
  assertEquals(result, { response: 'role created' })
  const created = rolesRepo.createRole.calls[0]?.[0] as Record<string, unknown>
  assertEquals(created.tenantId, 'tenant-b')
})

Deno.test('editRole: throws NOT_FOUND when the role does not exist', async () => {
  const { service } = buildService({ rolesRepo: { findById: fn(() => undefined) } })
  await assertRejects(() => service.editRole('missing', {} as never), HttpError, 'not found')
})

Deno.test('editRole: validates referenced permissions only when permissions is provided', async () => {
  const { service, permissionsRepo } = buildService()
  await service.editRole('role-1', { name: 'Renamed' } as never)
  assertEquals(permissionsRepo.findManyByIds.calls.length, 0)
})

Deno.test('editRole: on success updates the role with the given fields', async () => {
  const { service, rolesRepo } = buildService()
  const result = await service.editRole('role-1', { name: 'Renamed' } as never)
  assertEquals(result, { response: 'role edited' })
  assertEquals(rolesRepo.updateRole.calls[0], [{ name: 'Renamed', id: 'role-1' }])
})

Deno.test('deleteRole: throws NOT_FOUND when the role does not exist', async () => {
  const { service } = buildService({ rolesRepo: { findById: fn(() => undefined) } })
  await assertRejects(() => service.deleteRole('missing'), HttpError, 'not found')
})

Deno.test('deleteRole: on success deletes the role', async () => {
  const { service, rolesRepo } = buildService()
  const result = await service.deleteRole('role-1')
  assertEquals(result, { response: 'role deleted' })
  assertEquals(rolesRepo.deleteRole.calls[0], ['role-1'])
})

Deno.test('getRoleById: throws NOT_FOUND when the role does not exist', async () => {
  const { service } = buildService({ rolesRepo: { findById: fn(() => undefined) } })
  await assertRejects(() => service.getRoleById('missing'), HttpError, 'not found')
})

Deno.test('getRoleById: populates permissions', async () => {
  const { service, rolesRepo } = buildService()
  await service.getRoleById('role-1')
  assertEquals(rolesRepo.findById.calls[0], ['role-1', { populate: 'permissions' }])
})

Deno.test('assignRole: throws NOT_FOUND when the role does not exist', async () => {
  const { service } = buildService({ rolesRepo: { findById: fn(() => undefined) } })
  await assertRejects(
    () => service.assignRole({ authId: 'auth-1', roleId: 'missing' } as never),
    HttpError,
    'Role not found',
  )
})

Deno.test('assignRole: throws NOT_FOUND when the account does not exist', async () => {
  const { service } = buildService({ authRepo: { findById: fn(() => undefined) } })
  await assertRejects(
    () => service.assignRole({ authId: 'missing', roleId: 'role-1' } as never),
    HttpError,
    'Account not found',
  )
})

Deno.test('getRoles: forwards an explicit tenantId filter to the repository as-is', async () => {
  const { service, rolesRepo } = buildService()
  await service.getRoles({ tenantId: 'tenant-a' })
  assertEquals(rolesRepo.searchRoles.calls[0], [{ tenantId: 'tenant-a' }])
})

Deno.test('getRoles: with no tenantId, lists regardless of tenant', async () => {
  const { service, rolesRepo } = buildService()
  await service.getRoles({})
  assertEquals(rolesRepo.searchRoles.calls[0], [{}])
})

Deno.test('assignRole: on success sets roleId, without forcing a refresh-token revoke', async () => {
  const { service, authRepo } = buildService()
  const result = await service.assignRole({ authId: 'auth-1', roleId: 'role-1' } as never)
  assertEquals(result, { response: 'role assigned' })
  // A single `updateAuth` call, setting only `roleId` — no other write of any kind (no forced
  // re-login/revoke). `AuthService.refreshTokens` re-resolves permissions on every refresh now,
  // making a revoke unnecessary. See `RolesService.assignRole`'s own doc.
  assertEquals(authRepo.updateAuth.calls, [[{ id: 'auth-1', roleId: 'role-1' }]])
})
