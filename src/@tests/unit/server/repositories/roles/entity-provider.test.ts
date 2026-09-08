import { assertEquals } from 'jsr:@std/assert@0.224'

import { RolesRepository } from 'server/repositories/roles/entity.provider.ts'
import { fn } from '../../../helpers/mock.ts'

/**
 * `RolesRepository`'s own real conditional query construction (`findById`'s optional `populate`,
 * `findByCode`'s `tenantId`-present-vs-absent branch, `searchRoles`'s `tenantId` filter) — none of
 * it exercised anywhere else, since every interactor caller mocks this class away entirely.
 * Correctly `unit/` per `zanix-test-tier-conventions` — see
 * `../auth/entity-provider.test.ts`'s own doc for why `database` is shadowed on the prototype.
 */
function buildRepository(stubModel: Record<string, unknown>): RolesRepository {
  const fakeDatabase = { getModel: () => stubModel }
  Object.defineProperty(RolesRepository.prototype, 'database', {
    get: () => fakeDatabase,
    configurable: true,
  })
  try {
    return new RolesRepository()
  } finally {
    delete (RolesRepository.prototype as unknown as { database?: unknown }).database
  }
}

Deno.test('RolesRepository.findById: a falsy id short-circuits without querying the model', () => {
  const findById = fn(() => ({ exec: () => Promise.resolve(undefined) }))
  const repo = buildRepository({ findById })

  assertEquals(repo.findById(undefined), undefined)
  assertEquals(findById.calls.length, 0)
})

Deno.test('RolesRepository.findById: with no populate option, execs the plain query directly', () => {
  const exec = fn(() => Promise.resolve('doc'))
  const findById = fn((_id: string) => ({ exec }))
  const repo = buildRepository({ findById })

  repo.findById('role-1')

  assertEquals(findById.calls[0][0], 'role-1')
  assertEquals(exec.calls.length, 1)
})

Deno.test('RolesRepository.findById: with a populate option, populates before executing', () => {
  const populatedExec = fn(() => Promise.resolve('doc'))
  const populate = fn((_path: string) => ({ exec: populatedExec }))
  const findById = fn((_id: string) => ({ populate }))
  const repo = buildRepository({ findById })

  repo.findById('role-1', { populate: 'permissions' })

  assertEquals(populate.calls[0][0], 'permissions')
  assertEquals(populatedExec.calls.length, 1)
})

Deno.test('RolesRepository.findByCode: an omitted tenantId looks up the GLOBAL role only', () => {
  const findOne = fn((_filter: Record<string, unknown>) => ({
    exec: () => Promise.resolve(undefined),
  }))
  const repo = buildRepository({ findOne })

  repo.findByCode('admin')

  assertEquals(findOne.calls[0][0], { code: 'admin', tenantId: { $exists: false } })
})

Deno.test('RolesRepository.findByCode: a given tenantId is an exact filter, not merged with global', () => {
  const findOne = fn((_filter: Record<string, unknown>) => ({
    exec: () => Promise.resolve(undefined),
  }))
  const repo = buildRepository({ findOne })

  repo.findByCode('admin', 'tenant-1')

  assertEquals(findOne.calls[0][0], { code: 'admin', tenantId: 'tenant-1' })
})

Deno.test('RolesRepository.searchRoles: tenantId omitted lists every role regardless of tenant', () => {
  const paginate = fn((_opts: Record<string, unknown>) => Promise.resolve({ docs: [], total: 0 }))
  const repo = buildRepository({ paginate })

  repo.searchRoles({})

  assertEquals(paginate.calls[0][0].filter, undefined)
})

Deno.test('RolesRepository.searchRoles: a given tenantId is an exact filter', () => {
  const paginate = fn((_opts: Record<string, unknown>) => Promise.resolve({ docs: [], total: 0 }))
  const repo = buildRepository({ paginate })

  repo.searchRoles({ tenantId: 'tenant-1' })

  assertEquals(paginate.calls[0][0].filter, { tenantId: 'tenant-1' })
})
