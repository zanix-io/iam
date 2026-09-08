import { assertEquals } from 'jsr:@std/assert@0.224'

import { GrantAccessRepository } from 'server/repositories/grant-access/entity.provider.ts'
import { fn } from '../../../helpers/mock.ts'

/**
 * `GrantAccessRepository`'s own real conditional filter construction (`findOne`'s
 * `tenantId`-present-vs-absent branch, `searchGrants`'s per-field optional filter) — none of it
 * exercised anywhere else, since every interactor caller mocks this class away entirely.
 * Correctly `unit/` per `zanix-test-tier-conventions` — see
 * `../auth/entity-provider.test.ts`'s own doc for why `database` is shadowed on the prototype.
 */
function buildRepository(stubModel: Record<string, unknown>): GrantAccessRepository {
  const fakeDatabase = { getModel: () => stubModel }
  Object.defineProperty(GrantAccessRepository.prototype, 'database', {
    get: () => fakeDatabase,
    configurable: true,
  })
  try {
    return new GrantAccessRepository()
  } finally {
    delete (GrantAccessRepository.prototype as unknown as { database?: unknown }).database
  }
}

Deno.test('GrantAccessRepository.findOne: an omitted tenantId looks up the GLOBAL grant only', () => {
  const findOne = fn((_filter: Record<string, unknown>) => ({
    exec: () => Promise.resolve(undefined),
  }))
  const repo = buildRepository({ findOne })

  repo.findOne('user-1', 'resource-1')

  assertEquals(findOne.calls[0][0], {
    userId: 'user-1',
    resourceId: 'resource-1',
    tenantId: { $exists: false },
  })
})

Deno.test('GrantAccessRepository.findOne: a given tenantId is an exact filter', () => {
  const findOne = fn((_filter: Record<string, unknown>) => ({
    exec: () => Promise.resolve(undefined),
  }))
  const repo = buildRepository({ findOne })

  repo.findOne('user-1', 'resource-1', 'tenant-1')

  assertEquals(findOne.calls[0][0], {
    userId: 'user-1',
    resourceId: 'resource-1',
    tenantId: 'tenant-1',
  })
})

Deno.test('GrantAccessRepository.searchGrants: only sets a field filter when actually given', () => {
  const paginate = fn((_opts: Record<string, unknown>) => Promise.resolve({ docs: [], total: 0 }))
  const repo = buildRepository({ paginate })

  repo.searchGrants({})
  assertEquals(paginate.calls[0][0].filter, {})

  repo.searchGrants({ userId: 'user-1', resourceId: 'resource-1', tenantId: 'tenant-1' })
  assertEquals(paginate.calls[1][0].filter, {
    userId: 'user-1',
    resourceId: 'resource-1',
    tenantId: 'tenant-1',
  })
})

Deno.test('GrantAccessRepository.findById: a falsy id short-circuits without querying the model', () => {
  const findById = fn(() => ({ exec: () => Promise.resolve(undefined) }))
  const repo = buildRepository({ findById })

  assertEquals(repo.findById(undefined), undefined)
  assertEquals(findById.calls.length, 0)
})
