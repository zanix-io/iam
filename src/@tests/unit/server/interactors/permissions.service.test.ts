import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'

import { PermissionsService } from 'server/interactors/permissions.interactor.ts'
import { PermissionsRepository } from 'server/repositories/permissions/entity.provider.ts'
import { fn, mapGetter, mockAccessor } from '../../helpers/mock.ts'

const basePermission = (overrides: Record<string, unknown> = {}) => ({
  id: 'perm-1',
  code: 'zanix-iam:role-read',
  name: 'Read roles',
  description: 'x',
  isActive: true,
  ...overrides,
})

const defaultPermissionsRepo = () => ({
  createPermission: fn((..._args: unknown[]) => ({})),
  findById: fn((..._args: unknown[]): unknown => basePermission()),
  findByCode: fn((..._args: unknown[]): unknown => undefined),
  updatePermission: fn((..._args: unknown[]) => ({})),
  searchPermissions: fn((..._args: unknown[]) => ({ docs: [basePermission()], total: 1 })),
})

function buildService(opts: {
  permissionsRepo?: Partial<ReturnType<typeof defaultPermissionsRepo>>
  session?: Record<string, unknown>
} = {}) {
  const permissionsRepo = { ...defaultPermissionsRepo(), ...opts.permissionsRepo }

  const service = new PermissionsService('ctx-1')
  mockAccessor(
    service,
    'providers',
    mapGetter([[PermissionsRepository, permissionsRepo]]),
  )
  mockAccessor(service, 'context', { session: opts.session ?? { subject: 'admin-1' } })

  return { service, permissionsRepo }
}

Deno.test('createPermission: throws CONFLICT when the code already exists', async () => {
  const { service } = buildService({
    permissionsRepo: { findByCode: fn(() => basePermission()) },
  })
  await assertRejects(
    () => service.createPermission({ code: 'zanix-iam:role-read' } as never),
    HttpError,
    'already exists',
  )
})

Deno.test('createPermission: on success persists the permission with the caller as createdBy', async () => {
  const { service, permissionsRepo } = buildService()
  const result = await service.createPermission({
    code: 'zanix-iam:role-read',
    name: 'Read roles',
    description: 'x',
    isActive: true,
  } as never)
  assertEquals(result, { response: 'permission created' })
  const created = permissionsRepo.createPermission.calls[0]?.[0] as Record<string, unknown>
  assertEquals(created.createdBy, 'admin-1')
})

Deno.test('editPermission: throws NOT_FOUND when the permission does not exist', async () => {
  const { service } = buildService({ permissionsRepo: { findById: fn(() => undefined) } })
  await assertRejects(
    () => service.editPermission('missing', {} as never),
    HttpError,
    'not found',
  )
})

Deno.test('editPermission: on success updates the permission with the given fields', async () => {
  const { service, permissionsRepo } = buildService()
  const result = await service.editPermission('perm-1', { isActive: false } as never)
  assertEquals(result, { response: 'permission edited' })
  assertEquals(permissionsRepo.updatePermission.calls[0], [{ isActive: false, id: 'perm-1' }])
})

Deno.test('getPermissionById: throws NOT_FOUND when the permission does not exist', async () => {
  const { service } = buildService({ permissionsRepo: { findById: fn(() => undefined) } })
  await assertRejects(() => service.getPermissionById('missing'), HttpError, 'not found')
})

Deno.test('getPermissions: returns the paginated catalog', async () => {
  const { service } = buildService()
  const result = await service.getPermissions({})
  assertEquals(result.total, 1)
  assertEquals(result.docs[0].id, 'perm-1')
})
