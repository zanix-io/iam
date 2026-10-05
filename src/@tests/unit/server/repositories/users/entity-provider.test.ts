import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'

import { UsersRepository } from 'server/repositories/users/entity.provider.ts'
import { fn } from '../../../helpers/mock.ts'

/**
 * `UsersRepository.assertActive`'s own real 4-way branch (no `userId` / no matching profile /
 * `INACTIVE` / `DELETED` / active) — none of it exercised anywhere else, since every interactor
 * caller mocks `UsersRepository` away entirely. Correctly `unit/` per
 * `zanix-test-tier-conventions` — see `../auth/entity-provider.test.ts`'s own doc for why
 * `database` is shadowed on the prototype rather than the instance.
 */
function buildRepository(stubModel: Record<string, unknown>): UsersRepository {
  const fakeDatabase = { getModel: () => stubModel }
  Object.defineProperty(UsersRepository.prototype, 'database', {
    get: () => fakeDatabase,
    configurable: true,
  })
  try {
    return new UsersRepository()
  } finally {
    delete (UsersRepository.prototype as unknown as { database?: unknown }).database
  }
}

Deno.test('UsersRepository.assertActive: a no-op when userId is unset', async () => {
  const findById = fn(() => ({ exec: () => Promise.resolve(undefined) }))
  const repo = buildRepository({ findById })
  await repo.assertActive(undefined)
  assertEquals(findById.calls.length, 0)
})

Deno.test('UsersRepository.assertActive: a no-op when userId resolves to no profile', async () => {
  const findById = fn(() => ({ exec: () => Promise.resolve(undefined) }))
  const repo = buildRepository({ findById })
  await repo.assertActive('user-1')
})

Deno.test('UsersRepository.assertActive: a no-op for an ACTIVE profile', async () => {
  const findById = fn(() => ({ exec: () => Promise.resolve({ status: 'ACTIVE' }) }))
  const repo = buildRepository({ findById })
  await repo.assertActive('user-1')
})

Deno.test('UsersRepository.assertActive: throws FORBIDDEN for an INACTIVE profile', async () => {
  const findById = fn(() => ({ exec: () => Promise.resolve({ status: 'INACTIVE' }) }))
  const repo = buildRepository({ findById })
  await assertRejects(
    () => repo.assertActive('user-1'),
    HttpError,
  )
})

Deno.test('UsersRepository.assertActive: throws FORBIDDEN for a DELETED profile, with a distinct message', async () => {
  const findById = fn(() => ({ exec: () => Promise.resolve({ status: 'DELETED' }) }))
  const repo = buildRepository({ findById })
  const error = await assertRejects(
    () => repo.assertActive('user-1'),
    HttpError,
  )
  assertEquals(error.message, 'This account no longer exists.')
})

Deno.test('UsersRepository.reactivate: sets status back to ACTIVE', async () => {
  const updateOne = fn((..._args: unknown[]) => ({ exec: () => Promise.resolve({ n: 1 }) }))
  const repo = buildRepository({ updateOne })
  await repo.reactivate('user-1')
  assertEquals(updateOne.calls[0], [{ _id: 'user-1' }, { $set: { status: 'ACTIVE' } }])
})

Deno.test('UsersRepository.searchUsers: filters by status only when given', () => {
  const paginate = fn((_opts: Record<string, unknown>) => Promise.resolve({ docs: [], total: 0 }))
  const repo = buildRepository({ paginate })

  repo.searchUsers({})
  assertEquals(paginate.calls[0][0].filter, {})

  repo.searchUsers({ status: 'ACTIVE' })
  assertEquals(paginate.calls[1][0].filter, { status: 'ACTIVE' })
})

Deno.test('UsersRepository: registerUser saves a new profile; findById targets the id', async () => {
  const { recordingModel } = await import('../../../helpers/mock-model.ts')
  const { Model, calls, created } = recordingModel()
  const repo = buildRepository(Model)

  assertEquals(await repo.registerUser({ firstName: 'Jane' }) as unknown, {
    id: 'saved-1',
    firstName: 'Jane',
  })
  assertEquals(created, [{ firstName: 'Jane' }])
  await repo.findById('user-1')
  assertEquals(calls.findById, [['user-1']])
})

Deno.test('UsersRepository.updateUser: forwards applyProtection as the data-policy switch, off by default', async () => {
  const { recordingModel } = await import('../../../helpers/mock-model.ts')
  const { Model, calls } = recordingModel()
  const repo = buildRepository(Model)

  await repo.updateUser({ id: 'user-1', phoneNumber: '+14155551234' }, { applyProtection: true })
  await repo.updateUser({ id: 'user-1', firstName: 'Jane' })
  assertEquals(calls.updateOne, [
    [{ _id: 'user-1' }, { $set: { phoneNumber: '+14155551234' } }, { useDataPolicies: true }],
    [{ _id: 'user-1' }, { $set: { firstName: 'Jane' } }, { useDataPolicies: undefined }],
  ])
})

Deno.test('UsersRepository.findById: a falsy id short-circuits without querying the model', async () => {
  const { recordingModel } = await import('../../../helpers/mock-model.ts')
  const { Model, calls } = recordingModel()
  const repo = buildRepository(Model)
  assertEquals(repo.findById(undefined), undefined)
  assertEquals(repo.findById(''), undefined)
  assertEquals(calls.findById, undefined)
})

Deno.test('UsersRepository.findSignInBlockedIds: one query for the profiles whose status blocks sign-in', async () => {
  const find = fn((_filter: Record<string, unknown>) => ({
    select: (_fields: string) => ({
      exec: () => Promise.resolve([{ id: 'u2' }, { _id: 'u3' }]),
    }),
  }))
  const repo = buildRepository({ find })
  assertEquals(await repo.findSignInBlockedIds(['u1', 'u2', 'u3']), new Set(['u2', 'u3']))
  assertEquals(find.calls, [[{
    _id: { $in: ['u1', 'u2', 'u3'] },
    status: { $in: ['INACTIVE', 'DELETED'] },
  }]])
  assertEquals(await repo.findSignInBlockedIds([]), new Set())
  assertEquals(find.calls.length, 1)
})

Deno.test('UsersRepository.findManyByIds: one $in query, nothing for no ids', async () => {
  const find = fn((_filter: Record<string, unknown>) => ({ exec: () => Promise.resolve(['a']) }))
  const repo = buildRepository({ find })
  assertEquals(await repo.findManyByIds(['u1', 'u2']) as unknown, ['a'])
  assertEquals(await repo.findManyByIds([]), [])
  assertEquals(find.calls, [[{ _id: { $in: ['u1', 'u2'] } }]])
})

Deno.test('UsersRepository.restoreStatus: puts the previous status back only if the current one is still the one written', async () => {
  const updateOne = fn((_filter: Record<string, unknown>, _update: Record<string, unknown>) => ({
    exec: () => Promise.resolve({ matchedCount: 0 }),
  }))
  const repo = buildRepository({ updateOne })
  assertEquals(await repo.restoreStatus('u1', 'INACTIVE', 'ACTIVE'), false)
  assertEquals(updateOne.calls[0], [{ _id: 'u1', status: 'INACTIVE' }, {
    $set: { status: 'ACTIVE' },
  }])
})
