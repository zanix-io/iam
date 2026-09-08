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

Deno.test('UsersRepository.searchUsers: filters by status only when given', () => {
  const paginate = fn((_opts: Record<string, unknown>) => Promise.resolve({ docs: [], total: 0 }))
  const repo = buildRepository({ paginate })

  repo.searchUsers({})
  assertEquals(paginate.calls[0][0].filter, {})

  repo.searchUsers({ status: 'ACTIVE' })
  assertEquals(paginate.calls[1][0].filter, { status: 'ACTIVE' })
})
