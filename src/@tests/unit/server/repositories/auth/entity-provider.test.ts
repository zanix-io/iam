import { assertEquals } from 'jsr:@std/assert@0.224'

import { AuthRepository } from 'server/repositories/auth/entity.provider.ts'
import { computeEmailKeyId } from 'server/repositories/auth/email-key.ts'
import { fn } from '../../../helpers/mock.ts'

/**
 * `AuthRepository`'s own real, isolated logic — `emailKeyId` derivation, `findByEmail`'s query
 * shape, and `updateAuth`'s conditional `$unset` construction — none of it exercised anywhere
 * else, unlike its interactor callers (`AuthService`/`PasswordService`), which mock this class
 * away entirely (see those tests' own `mock.ts`-based fakes). Correctly `unit/` per
 * `zanix-test-tier-conventions`: a real Mongo connection is never involved, only a hand-rolled
 * stub `Model`.
 *
 * `database` is a `protected get` inherited from `@zanix/server`'s `CoreBaseClass`
 * (`this.database.getModel(...)`), read synchronously inside `AuthRepository`'s OWN constructor —
 * too early for the usual post-construction `mockAccessor(instance, 'providers', ...)` pattern
 * (`mock.ts`'s own doc) to reach. Shadowing the inherited accessor on the class's own prototype
 * for the duration of construction, then restoring it, gets a real instance with a fully-stubbed
 * `Model` and no DI container involved at all.
 */
function buildRepository(stubModel: Record<string, unknown>): AuthRepository {
  const fakeDatabase = { getModel: () => stubModel }
  Object.defineProperty(AuthRepository.prototype, 'database', {
    get: () => fakeDatabase,
    configurable: true,
  })
  try {
    return new AuthRepository()
  } finally {
    delete (AuthRepository.prototype as unknown as { database?: unknown }).database
  }
}

Deno.test('AuthRepository.registerAuth: derives and persists emailKeyId alongside the given data', async () => {
  const save = fn(() => Promise.resolve({ id: 'auth-1' }))
  let constructedWith: Record<string, unknown> | undefined
  // A real, `new`-able constructor function — `registerAuth` calls `new this.Model(...)`.
  function FakeModel(this: Record<string, unknown>, data: Record<string, unknown>) {
    constructedWith = data
    Object.assign(this, data)
    this.save = save
  }
  const repo = buildRepository(FakeModel as unknown as Record<string, unknown>)

  const expectedKeyId = await computeEmailKeyId('jane@example.com')
  await repo.registerAuth({ email: 'jane@example.com', password: 'secret' })

  assertEquals(constructedWith?.email, 'jane@example.com')
  assertEquals(constructedWith?.password, 'secret')
  assertEquals(constructedWith?.emailKeyId, expectedKeyId)
})

Deno.test('AuthRepository.findByEmail: queries by the derived emailKeyId digest, never the raw email', async () => {
  const findOne = fn((_filter: Record<string, unknown>) => ({ exec: () => Promise.resolve('doc') }))
  const repo = buildRepository({ findOne })

  const result = await repo.findByEmail('jane@example.com')

  const expectedKeyId = await computeEmailKeyId('jane@example.com')
  assertEquals(findOne.calls[0][0], { emailKeyId: expectedKeyId })
  assertEquals(result as unknown, 'doc')
})

Deno.test('AuthRepository.findById: a falsy id short-circuits without querying the model', () => {
  const findById = fn(() => ({ exec: () => Promise.resolve('doc') }))
  const repo = buildRepository({ findById })

  assertEquals(repo.findById(undefined), undefined)
  assertEquals(findById.calls.length, 0)
})

type UpdateOneArgs = [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>]

Deno.test('AuthRepository.updateAuth: builds a plain $set with no $unset when none is requested', () => {
  const updateOne = fn((..._args: UpdateOneArgs) => ({ exec: () => Promise.resolve({}) }))
  const repo = buildRepository({ updateOne })

  repo.updateAuth({ id: 'auth-1', mustChangePassword: false })

  const [filter, update, options] = updateOne.calls[0]
  assertEquals(filter, { _id: 'auth-1' })
  assertEquals(update, { $set: { mustChangePassword: false } })
  assertEquals(update.$unset, undefined)
  assertEquals(options, { useDataPolicies: undefined })
})

Deno.test('AuthRepository.updateAuth: builds a real $unset for every requested field', () => {
  const updateOne = fn((..._args: UpdateOneArgs) => ({ exec: () => Promise.resolve({}) }))
  const repo = buildRepository({ updateOne })

  repo.updateAuth(
    { id: 'auth-1' },
    { applyProtection: true, unset: ['mustChangePassword', 'totpSecret'] },
  )

  const [, update, options] = updateOne.calls[0]
  assertEquals(update.$unset, { mustChangePassword: '', totpSecret: '' })
  assertEquals(options, { useDataPolicies: true })
})

Deno.test('AuthRepository.findById: a given id queries the model by that id', async () => {
  const { recordingModel } = await import('../../../helpers/mock-model.ts')
  const { Model, calls } = recordingModel({ id: 'auth-1' })
  const repo = buildRepository(Model)
  assertEquals(await repo.findById('auth-1') as unknown, { id: 'auth-1' })
  assertEquals(calls.findById, [['auth-1']])
})

Deno.test('AuthRepository.registerAuth: persists roleIds as given, and no role fields when none', async () => {
  const { recordingModel } = await import('../../../helpers/mock-model.ts')
  const { Model, created } = recordingModel()
  const repo = buildRepository(Model)
  await repo.registerAuth({ email: 'a@example.com', roleIds: ['r1', 'r2'] })
  await repo.registerAuth({ email: 'b@example.com' })
  const [withRoles, withoutRoles] = created as Record<string, unknown>[]
  assertEquals(withRoles.roleIds, ['r1', 'r2'])
  assertEquals('roleIds' in withoutRoles, false)
  assertEquals('roleId' in withRoles, false)
})

Deno.test('AuthRepository.addRoleIds: one atomic $addToSet of the given roles', async () => {
  const { recordingModel } = await import('../../../helpers/mock-model.ts')
  const { Model, calls } = recordingModel()
  await buildRepository(Model).addRoleIds('auth-1', ['r1', 'r2'])
  assertEquals(calls.updateOne, [[
    { _id: 'auth-1' },
    { $addToSet: { roleIds: { $each: ['r1', 'r2'] } } },
  ]])
})

Deno.test('AuthRepository.replaceRoleIds/pullRoleIds: conditioned on the roles still being the ones read', async () => {
  const updateOne = fn((_filter: Record<string, unknown>, _update: Record<string, unknown>) => ({
    exec: () => Promise.resolve({ matchedCount: 1 }),
  }))
  const repo = buildRepository({ updateOne })
  assertEquals(await repo.replaceRoleIds('auth-1', ['r1', 'r2'], ['r3']), true)
  assertEquals(await repo.pullRoleIds('auth-1', ['r1', 'r2'], ['r2']), true)
  assertEquals(updateOne.calls, [
    [{ _id: 'auth-1', roleIds: ['r1', 'r2'] }, { $set: { roleIds: ['r3'] } }],
    [{ _id: 'auth-1', roleIds: ['r1', 'r2'] }, { $pull: { roleIds: { $in: ['r2'] } } }],
  ])
})

Deno.test('AuthRepository.replaceRoleIds: an account with no roles matches a missing or empty roleIds', async () => {
  const updateOne = fn((_filter: Record<string, unknown>, _update: Record<string, unknown>) => ({
    exec: () => Promise.resolve({ matchedCount: 0 }),
  }))
  const repo = buildRepository({ updateOne })
  assertEquals(await repo.replaceRoleIds('auth-1', [], ['r1']), false, 'no match is reported')
  assertEquals(updateOne.calls[0][0], {
    _id: 'auth-1',
    $or: [{ roleIds: { $exists: false } }, { roleIds: { $size: 0 } }],
  })
})

Deno.test('AuthRepository.findHoldersOfRoleIds: holders of any role, except the given account, as ids', async () => {
  const find = fn((_filter: Record<string, unknown>) => ({
    select: (_fields: string) => ({
      exec: () => Promise.resolve([{ id: 'a1', userId: 'u1' }, { _id: 'a2' }]),
    }),
  }))
  const repo = buildRepository({ find })
  assertEquals(await repo.findHoldersOfRoleIds(['r1', 'r2'], 'auth-1'), [
    { id: 'a1', userId: 'u1' },
    { id: 'a2', userId: undefined },
  ])
  await repo.findHoldersOfRoleIds(['r1'])
  assertEquals(find.calls, [
    [{ roleIds: { $in: ['r1', 'r2'] }, _id: { $ne: 'auth-1' } }],
    [{ roleIds: { $in: ['r1'] } }],
  ])
})

Deno.test('AuthRepository.findByUserId / findRolesByUserIds: the account of a profile, and the roles of many in one query', async () => {
  const findOne = fn((_filter: Record<string, unknown>) => ({ exec: () => Promise.resolve('doc') }))
  const find = fn((_filter: Record<string, unknown>) => ({
    select: (_fields: string) => ({
      exec: () =>
        Promise.resolve([
          { id: 'a1', userId: 'u1', roleIds: ['r1', 'r2'] },
          { id: 'a2', userId: 'u2' },
        ]),
    }),
  }))
  const repo = buildRepository({ findOne, find })
  assertEquals(await repo.findByUserId('u1') as unknown, 'doc')
  assertEquals(repo.findByUserId(undefined), undefined)
  assertEquals(
    await repo.findRolesByUserIds(['u1', 'u2']),
    [
      { id: 'a1', userId: 'u1', roleIds: ['r1', 'r2'] },
      { id: 'a2', userId: 'u2', roleIds: [] },
    ],
  )
  assertEquals(await repo.findRolesByUserIds([]), [])
  assertEquals(findOne.calls, [[{ userId: 'u1' }]])
  assertEquals(find.calls, [[{ userId: { $in: ['u1', 'u2'] } }]])
})

Deno.test('AuthRepository.countHolders / searchHolders: how many hold a role, and one page of who', async () => {
  const countDocuments = fn((_filter: Record<string, unknown>) => ({
    exec: () => Promise.resolve(7),
  }))
  const paginate = fn((_options: Record<string, unknown>) =>
    Promise.resolve({
      total: 7,
      page: 2,
      limit: 3,
      docs: [{ id: 'a1', userId: 'u1' }, { id: 'a2' }],
    })
  )
  const repo = buildRepository({ countDocuments, paginate })
  assertEquals(await repo.countHolders('r1'), 7)
  assertEquals(await repo.searchHolders('r1', { page: 2, limit: 3 }), {
    total: 7,
    page: 2,
    limit: 3,
    docs: [{ id: 'a1', userId: 'u1' }, { id: 'a2', userId: undefined }],
  })
  assertEquals(countDocuments.calls, [[{ roleIds: 'r1' }]])
  assertEquals(paginate.calls, [[{
    page: 2,
    limit: 3,
    sort: { _id: 1 },
    filter: { roleIds: 'r1' },
  }]])
})
