import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'

import { PermissionsService } from 'server/interactors/permissions.interactor.ts'
import { PermissionsRepository } from 'server/repositories/permissions/entity.provider.ts'
import { fn, mapGetter, mockAccessor } from '../../helpers/mock.ts'
import { buildWorld, perm, role } from '../../helpers/role-world.ts'

/**
 * `PermissionsService`: creating, editing and reading the catalog. The rules an edit shares with
 * the rest of role administration (grant only what you hold, an administrator remains) have their
 * own files: `permissions.service.grant-rules.test.ts` and `roles.service.admin-remains.test.ts`.
 */
const basePermission = (overrides: Record<string, unknown> = {}) => ({
  id: 'perm-1',
  code: 'zanix-iam:role-read',
  name: 'Read roles',
  description: 'x',
  isActive: true,
  ...overrides,
})

Deno.test('createPermission: throws CONFLICT when the code already exists', async () => {
  const w = buildWorld({ roles: [role('r', [perm('shop:buy')])] })
  await assertRejects(
    () =>
      w.permissions.createPermission({ code: 'shop:buy', name: 'n', description: 'd' } as never),
    HttpError,
    'already exists',
  )
  assertEquals(w.state.createdPermissions, [])
})

Deno.test('createPermission: persists the permission with the caller as createdBy, and audits it with the new id', async () => {
  const w = buildWorld()
  const result = await w.permissions.createPermission({
    code: 'shop:sell',
    name: 'Sell',
    description: 'Sell things',
    categories: ['shop'],
    isActive: true,
  } as never)
  assertEquals(result, { response: 'permission created' })
  assertEquals(w.state.createdPermissions, [{
    code: 'shop:sell',
    name: 'Sell',
    description: 'Sell things',
    categories: ['shop'],
    isActive: true,
    createdBy: 'caller',
  }])
  const [event] = w.events('permissions.create')
  assertEquals([event.result, (event.target as { id?: string }).id], ['ok', 'p-new-1'])
})

Deno.test('createPermission: needs permission-write now, not only in the token', async () => {
  const w = buildWorld({ session: { subject: 'caller', scope: ['zanix-iam:role-read'] } })
  await assertRejects(
    () => w.permissions.createPermission({ code: 'a:b', name: 'n', description: 'd' } as never),
    HttpError,
    'permission-write',
  )
  assertEquals(w.state.createdPermissions, [])
  assertEquals(w.state.audit.map((event) => event.result), ['denied'])
})

Deno.test('editPermission: throws NOT_FOUND when the permission does not exist', async () => {
  const w = buildWorld()
  await assertRejects(
    () => w.permissions.editPermission('missing', { name: 'x' } as never),
    HttpError,
    'not found',
  )
})

Deno.test('editPermission: on success updates the permission with the given fields only', async () => {
  const w = buildWorld({ roles: [role('r', [perm('shop:buy')])] })
  const result = await w.permissions.editPermission('p-shop:buy', {
    isActive: false,
    name: undefined,
  } as never)
  assertEquals(result, { response: 'permission edited' })
  assertEquals(w.state.updatedPermissions, [{ isActive: false, id: 'p-shop:buy' }])
})

// The reads go through the repository alone.
function reads(permission: unknown) {
  const permissionsRepo = {
    findById: fn((..._args: unknown[]): unknown => permission),
    searchPermissions: fn((..._args: unknown[]) => ({ docs: [basePermission()], total: 1 })),
  }
  const service = new PermissionsService('ctx-1')
  mockAccessor(service, 'providers', mapGetter([[PermissionsRepository, permissionsRepo]]))
  mockAccessor(service, 'context', { session: { subject: 'admin-1', type: 'user' } })
  return service
}

Deno.test('getPermissionById: throws NOT_FOUND when the permission does not exist', async () => {
  await assertRejects(() => reads(undefined).getPermissionById('missing'), HttpError, 'not found')
})

Deno.test('getPermissionById: returns the permission when it exists', async () => {
  assertEquals(await reads(basePermission()).getPermissionById('perm-1'), basePermission())
})

Deno.test('getPermissions: returns the paginated catalog', async () => {
  assertEquals((await reads(undefined).getPermissions({})).total, 1)
})
