import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'

import { StepUpClaimRepository } from 'server/repositories/step-up-claim/entity.provider.ts'

/** See `../auth/entity-provider.test.ts` for why `database` is shadowed on the prototype. */
function buildRepository(stubModel: Record<string, unknown>): StepUpClaimRepository {
  const fakeDatabase = { getModel: () => stubModel }
  Object.defineProperty(StepUpClaimRepository.prototype, 'database', {
    get: () => fakeDatabase,
    configurable: true,
  })
  try {
    return new StepUpClaimRepository()
  } finally {
    delete (StepUpClaimRepository.prototype as unknown as { database?: unknown }).database
  }
}

const expireAt = new Date('2030-01-01T00:00:00Z')

Deno.test('StepUpClaimRepository.claim: the first claim of a key holds it, a duplicate-key refusal means it was held', async () => {
  const held = new Set<string>()
  const created: unknown[] = []
  const repository = buildRepository({
    create: (doc: { key: string }) => {
      created.push(doc)
      if (held.has(doc.key)) {
        return Promise.reject(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }))
      }
      held.add(doc.key)
      return Promise.resolve(doc)
    },
  })

  assertEquals(await repository.claim('jti:abc', expireAt), true)
  assertEquals(await repository.claim('jti:abc', expireAt), false)
  assertEquals(await repository.claim('jti:other', expireAt), true)
  assertEquals(created[0], { key: 'jti:abc', expireAt })
})

Deno.test('StepUpClaimRepository.claim: a duplicate is recognised by message too, and any other failure propagates', async () => {
  const duplicate = buildRepository({
    create: () => Promise.reject(new Error('E11000 duplicate key error collection')),
  })
  assertEquals(await duplicate.claim('k', expireAt), false)

  const broken = buildRepository({ create: () => Promise.reject(new Error('connection lost')) })
  await assertRejects(() => broken.claim('k', expireAt), Error, 'connection lost')
})
