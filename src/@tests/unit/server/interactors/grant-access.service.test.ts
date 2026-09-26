import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'

import { GrantAccessService } from 'server/interactors/grant-access.interactor.ts'
import { GrantAccessRepository } from 'server/repositories/grant-access/entity.provider.ts'
import { fn, mapGetter, mockAccessor } from '../../helpers/mock.ts'

const baseGrant = (overrides: Record<string, unknown> = {}) => ({
  id: 'grant-1',
  userId: 'user-1',
  resourceId: 'billing:chargeInvoice',
  accessLevel: 'READ',
  isActive: true,
  grantedBy: 'admin-1',
  ...overrides,
})

const defaultGrantRepo = () => ({
  createGrant: fn((..._args: unknown[]) => ({})),
  findById: fn((..._args: unknown[]): unknown => baseGrant()),
  findOne: fn((..._args: unknown[]): unknown => undefined),
  updateGrant: fn((..._args: unknown[]) => ({})),
  deleteGrant: fn((..._args: unknown[]) => ({})),
  searchGrants: fn((..._args: unknown[]) => ({ docs: [baseGrant()], total: 1 })),
})

function buildService(opts: {
  grantRepo?: Partial<ReturnType<typeof defaultGrantRepo>>
  session?: Record<string, unknown>
} = {}) {
  const grantRepo = { ...defaultGrantRepo(), ...opts.grantRepo }

  const service = new GrantAccessService('ctx-1')
  mockAccessor(
    service,
    'providers',
    mapGetter([[GrantAccessRepository, grantRepo]]),
  )
  mockAccessor(service, 'context', { session: opts.session ?? { subject: 'admin-1' } })

  return { service, grantRepo }
}

Deno.test('createGrant: with no tenantId, scopes the collision check to the global grant', async () => {
  const { service, grantRepo } = buildService()
  await service.createGrant({
    userId: 'user-1',
    resourceId: 'billing:chargeInvoice',
    accessLevel: 'READ',
  } as never)
  assertEquals(grantRepo.findOne.calls[0], ['user-1', 'billing:chargeInvoice', undefined])
})

Deno.test('createGrant: throws CONFLICT when a grant already exists for the same tuple', async () => {
  const { service } = buildService({ grantRepo: { findOne: fn(() => baseGrant()) } })
  await assertRejects(
    () =>
      service.createGrant({
        userId: 'user-1',
        resourceId: 'billing:chargeInvoice',
        accessLevel: 'READ',
      } as never),
    HttpError,
    'already exists',
  )
})

Deno.test('createGrant: the same user/resource is allowed for a different tenant (cross-tenant, no collision)', async () => {
  const { service, grantRepo } = buildService({
    grantRepo: {
      findOne: fn((..._args: unknown[]): unknown => {
        const [, , tenantId] = _args as [string, string, string | undefined]
        return tenantId === 'tenant-a' ? baseGrant({ tenantId: 'tenant-a' }) : undefined
      }),
    },
  })
  const result = await service.createGrant({
    userId: 'user-1',
    resourceId: 'billing:chargeInvoice',
    tenantId: 'tenant-b',
    accessLevel: 'READ',
  } as never)
  assertEquals(result, { response: 'grant created' })
  const created = grantRepo.createGrant.calls[0]?.[0] as Record<string, unknown>
  assertEquals(created.tenantId, 'tenant-b')
})

Deno.test('createGrant: on success persists the grant with the caller as grantedBy', async () => {
  const { service, grantRepo } = buildService()
  await service.createGrant({
    userId: 'user-1',
    resourceId: 'billing:chargeInvoice',
    accessLevel: 'READ',
  } as never)
  const created = grantRepo.createGrant.calls[0]?.[0] as Record<string, unknown>
  assertEquals(created.grantedBy, 'admin-1')
})

Deno.test('editGrant: throws NOT_FOUND when the grant does not exist', async () => {
  const { service } = buildService({ grantRepo: { findById: fn(() => undefined) } })
  await assertRejects(() => service.editGrant('missing', {} as never), HttpError, 'not found')
})

Deno.test('editGrant: on success updates the grant with the given fields', async () => {
  const { service, grantRepo } = buildService()
  const result = await service.editGrant('grant-1', { accessLevel: 'WRITE' } as never)
  assertEquals(result, { response: 'grant edited' })
  assertEquals(grantRepo.updateGrant.calls[0], [{ accessLevel: 'WRITE', id: 'grant-1' }])
})

Deno.test('revokeGrant: throws NOT_FOUND when the grant does not exist', async () => {
  const { service } = buildService({ grantRepo: { findById: fn(() => undefined) } })
  await assertRejects(() => service.revokeGrant('missing'), HttpError, 'not found')
})

Deno.test('revokeGrant: on success deletes the grant', async () => {
  const { service, grantRepo } = buildService()
  const result = await service.revokeGrant('grant-1')
  assertEquals(result, { response: 'grant revoked' })
  assertEquals(grantRepo.deleteGrant.calls[0], ['grant-1'])
})

Deno.test('getGrants: forwards an explicit tenantId filter to the repository as-is', async () => {
  const { service, grantRepo } = buildService()
  await service.getGrants({ tenantId: 'tenant-a' })
  assertEquals(grantRepo.searchGrants.calls[0], [{ tenantId: 'tenant-a' }])
})

Deno.test('getGrantById: throws NOT_FOUND when the grant does not exist', async () => {
  const { service } = buildService({ grantRepo: { findById: fn(() => undefined) } })
  await assertRejects(() => service.getGrantById('missing'), HttpError, 'not found')
})

Deno.test('checkAccess: returns allowed: false when no grant exists', async () => {
  const { service } = buildService({ grantRepo: { findOne: fn(() => undefined) } })
  const result = await service.checkAccess({
    userId: 'user-1',
    resourceId: 'billing:chargeInvoice',
    accessLevel: 'READ',
  } as never)
  assertEquals(result, { allowed: false })
})

Deno.test('checkAccess: uses the default evaluation strategy when no host override is registered', async () => {
  const { service } = buildService({
    grantRepo: { findOne: fn(() => baseGrant({ accessLevel: 'MANAGE' })) },
  })
  const result = await service.checkAccess({
    userId: 'user-1',
    resourceId: 'billing:chargeInvoice',
    accessLevel: 'READ',
  } as never)
  assertEquals(result, { allowed: true })
})

Deno.test('checkAccess: forwards userId/resourceId/tenantId to the repository lookup', async () => {
  const { service, grantRepo } = buildService()
  await service.checkAccess({
    userId: 'user-1',
    resourceId: 'billing:chargeInvoice',
    tenantId: 'tenant-a',
    accessLevel: 'READ',
  } as never)
  assertEquals(grantRepo.findOne.calls[0], ['user-1', 'billing:chargeInvoice', 'tenant-a'])
})

Deno.test('createGrant: a global-scope collision reports CONFLICT without a tenant qualifier', async () => {
  const { service } = buildService({ grantRepo: { findOne: fn(() => baseGrant()) } })
  const error = await assertRejects(
    () =>
      service.createGrant({
        userId: 'user-1',
        resourceId: 'billing:chargeInvoice',
        accessLevel: 'READ',
      } as never),
    HttpError,
  )
  assertEquals(error.message, 'A grant already exists for this user/resource.')
})

Deno.test('createGrant: a tenant-scoped collision reports CONFLICT within this tenant', async () => {
  const { service } = buildService({ grantRepo: { findOne: fn(() => baseGrant()) } })
  const error = await assertRejects(
    () =>
      service.createGrant({
        userId: 'user-1',
        resourceId: 'billing:chargeInvoice',
        accessLevel: 'READ',
        tenantId: 'tenant-a',
      } as never),
    HttpError,
  )
  assertEquals(error.message, 'A grant already exists for this user/resource within this tenant.')
})

Deno.test('getGrantById: returns the grant when it exists', async () => {
  const { service, grantRepo } = buildService()
  assertEquals(await service.getGrantById('grant-1') as unknown, baseGrant())
  assertEquals(grantRepo.findById.calls, [['grant-1']])
})
