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

Deno.test('RolesRepository: createRole saves a new document; updateRole/deleteRole target the id', async () => {
  const { recordingModel } = await import('../../../helpers/mock-model.ts')
  const { Model, calls, created } = recordingModel()
  const repo = buildRepository(Model)
  const data = { name: 'Editor', code: 'editor', description: 'Edits' }

  assertEquals(await repo.createRole(data) as unknown, { id: 'saved-1', ...data })
  assertEquals(created, [data])

  await repo.updateRole({ id: 'role-1', name: 'Renamed', description: undefined })
  await repo.deleteRole('role-1')
  assertEquals(calls.updateOne, [[{ _id: 'role-1' }, { $set: { name: 'Renamed' } }]])
  assertEquals(calls.deleteOne, [[{ _id: 'role-1' }]])
})

Deno.test('RolesRepository.findManyByIds: one $in query; no ids never queries', async () => {
  const find = fn((_filter: Record<string, unknown>) => ({
    exec: () => Promise.resolve(['plain']),
  }))
  const repo = buildRepository({ find })
  assertEquals(await repo.findManyByIds(['r1', 'r2']) as unknown, ['plain'])
  assertEquals(await repo.findManyByIds([]), [])
  assertEquals(find.calls, [[{ _id: { $in: ['r1', 'r2'] } }]])
})

Deno.test('RolesRepository.findManyWithPermissions/findAllWithPermissions: populate permissions', async () => {
  const populate = fn((_path: string) => ({ exec: () => Promise.resolve(['populated']) }))
  const find = fn((_filter: Record<string, unknown>) => ({ populate }))
  const repo = buildRepository({ find })
  assertEquals(await repo.findManyWithPermissions(['r1']) as unknown, ['populated'])
  assertEquals(await repo.findManyWithPermissions([]), [])
  assertEquals(await repo.findAllWithPermissions() as unknown, ['populated'])
  assertEquals(find.calls, [[{ _id: { $in: ['r1'] } }], [{}]])
  assertEquals(populate.calls, [['permissions'], ['permissions']])
})

Deno.test('RolesRepository.updateRole: with a version it matches only that updatedAt, and answers whether it matched', async () => {
  const updateOne = fn((_filter: Record<string, unknown>, _update: Record<string, unknown>) => ({
    exec: () => Promise.resolve({ matchedCount: updateOne.calls.length === 1 ? 1 : 0 }),
  }))
  const repo = buildRepository({ updateOne })
  const version = new Date('2026-01-01T00:00:00.000Z')
  assertEquals(await repo.updateRole({ id: 'role-1', name: 'A' }, { ifUpdatedAt: version }), true)
  assertEquals(await repo.updateRole({ id: 'role-1', name: 'B' }, { ifUpdatedAt: version }), false)
  assertEquals(updateOne.calls[0], [
    { _id: 'role-1', updatedAt: version },
    { $set: { name: 'A' } },
  ])
})

Deno.test('RolesRepository.replacePermissions: conditioned on the permissions still being the ones written', async () => {
  const updateOne = fn((_filter: Record<string, unknown>, _update: Record<string, unknown>) => ({
    exec: () => Promise.resolve({ matchedCount: 1 }),
  }))
  assertEquals(await buildRepository({ updateOne }).replacePermissions('r1', ['p2'], ['p1']), true)
  assertEquals(updateOne.calls[0], [
    { _id: 'r1', permissions: ['p2'] },
    { $set: { permissions: ['p1'] } },
  ])
})

Deno.test('RolesRepository.restoreRole: puts the role back with its id only if none exists', async () => {
  const updateOne = fn(
    (_filter: Record<string, unknown>, _update: Record<string, unknown>, _options: unknown) => ({
      exec: () => Promise.resolve({ upsertedCount: updateOne.calls.length === 1 ? 1 : 0 }),
    }),
  )
  const repo = buildRepository({ updateOne })
  const snapshot = {
    id: 'r1',
    name: 'Editor',
    code: 'editor',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  assertEquals(await repo.restoreRole(snapshot as never), true)
  assertEquals(await repo.restoreRole(snapshot as never), false)
  assertEquals(updateOne.calls[0], [
    { _id: 'r1' },
    { $setOnInsert: { name: 'Editor', code: 'editor' } },
    { upsert: true },
  ])
})
