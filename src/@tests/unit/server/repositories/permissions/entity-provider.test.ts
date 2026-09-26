import { assertEquals } from 'jsr:@std/assert@0.224'

import { PermissionsRepository } from 'server/repositories/permissions/entity.provider.ts'
import { fn } from '../../../helpers/mock.ts'

/**
 * `PermissionsRepository.findManyByIds`'s own real empty-array early return (avoids issuing a
 * `{ _id: { $in: [] } }` query, which would still correctly return nothing but is needless work) —
 * none of it exercised anywhere else, since `RolesService` mocks this class away entirely.
 * Correctly `unit/` per `zanix-test-tier-conventions` — see
 * `../auth/entity-provider.test.ts`'s own doc for why `database` is shadowed on the prototype.
 */
function buildRepository(stubModel: Record<string, unknown>): PermissionsRepository {
  const fakeDatabase = { getModel: () => stubModel }
  Object.defineProperty(PermissionsRepository.prototype, 'database', {
    get: () => fakeDatabase,
    configurable: true,
  })
  try {
    return new PermissionsRepository()
  } finally {
    delete (PermissionsRepository.prototype as unknown as { database?: unknown }).database
  }
}

Deno.test('PermissionsRepository.findManyByIds: an empty ids list short-circuits without querying the model', async () => {
  const find = fn(() => ({ exec: () => Promise.resolve([]) }))
  const repo = buildRepository({ find })

  const result = await repo.findManyByIds([])

  assertEquals(result, [])
  assertEquals(find.calls.length, 0)
})

Deno.test('PermissionsRepository.findManyByIds: queries $in for a non-empty ids list', async () => {
  const find = fn((_filter: Record<string, unknown>) => ({
    exec: () => Promise.resolve(['p1', 'p2']),
  }))
  const repo = buildRepository({ find })

  const result = await repo.findManyByIds(['p1', 'p2'])

  assertEquals(find.calls[0][0], { _id: { $in: ['p1', 'p2'] } })
  assertEquals(result as unknown, ['p1', 'p2'])
})

Deno.test('PermissionsRepository.findById: a falsy id short-circuits without querying the model', () => {
  const findById = fn(() => ({ exec: () => Promise.resolve(undefined) }))
  const repo = buildRepository({ findById })

  assertEquals(repo.findById(undefined), undefined)
  assertEquals(findById.calls.length, 0)
})

Deno.test('PermissionsRepository: create/findByCode/update/search build the expected model calls', async () => {
  const { recordingModel } = await import('../../../helpers/mock-model.ts')
  const { Model, calls, created } = recordingModel()
  const repo = buildRepository(Model)
  const data = { code: 'billing:invoice-read', name: 'Read invoices' }

  assertEquals(await repo.createPermission(data) as unknown, { id: 'saved-1', ...data })
  assertEquals(created, [data])

  await repo.findById('perm-1')
  await repo.findByCode('billing:invoice-read')
  await repo.updatePermission({ id: 'perm-1', isActive: false })
  await repo.searchPermissions({ query: 'invoice', page: 2, limit: 10, sortBy: { code: 1 } })
  await repo.searchPermissions()
  assertEquals(calls.findById, [['perm-1']])
  assertEquals(calls.findOne, [[{ code: 'billing:invoice-read' }]])
  assertEquals(calls.updateOne, [[{ _id: 'perm-1' }, { $set: { isActive: false } }]])
  assertEquals(calls.paginate, [
    [{
      page: 2,
      limit: 10,
      sort: { code: 1 },
      search: { query: 'invoice', fields: ['name', 'code'] },
    }],
    [{
      page: undefined,
      limit: undefined,
      sort: undefined,
      search: { query: undefined, fields: ['name', 'code'] },
    }],
  ])
})
