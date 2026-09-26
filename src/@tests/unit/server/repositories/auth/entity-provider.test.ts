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
