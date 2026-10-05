import { assertEquals } from 'jsr:@std/assert@0.224'

import { AuditRepository } from 'server/repositories/audit/entity.provider.ts'
import { fn } from '../../../helpers/mock.ts'

/** See `../auth/entity-provider.test.ts` for why `database` is shadowed on the prototype. */
function buildRepository(stubModel: Record<string, unknown>): AuditRepository {
  const fakeDatabase = { getModel: () => stubModel }
  Object.defineProperty(AuditRepository.prototype, 'database', {
    get: () => fakeDatabase,
    configurable: true,
  })
  try {
    return new AuditRepository()
  } finally {
    delete (AuditRepository.prototype as unknown as { database?: unknown }).database
  }
}

Deno.test('AuditRepository.begin: opens the event as pending and answers its id', async () => {
  const { recordingModel } = await import('../../../helpers/mock-model.ts')
  const { Model, created } = recordingModel()
  const id = await buildRepository(Model).begin({
    actor: 'auth-1',
    action: 'roles.add',
    target: { kind: 'account', id: 'auth-2' },
    requestId: 'req-1',
  })
  assertEquals(id, 'saved-1')
  assertEquals(created, [{
    actor: 'auth-1',
    action: 'roles.add',
    target: { kind: 'account', id: 'auth-2' },
    requestId: 'req-1',
    result: 'pending',
  }])
})

Deno.test('AuditRepository.finish: closes the event with its result and only the details given', async () => {
  const { recordingModel } = await import('../../../helpers/mock-model.ts')
  const { Model, calls } = recordingModel()
  const repo = buildRepository(Model)
  await repo.finish('e1', 'denied', { reason: 'ROLE_SELF_CHANGE', before: undefined })
  await repo.finish('e2', 'ok', { before: { roleIds: [] }, after: { roleIds: ['r1'] } })
  assertEquals(calls.updateOne, [
    [{ _id: 'e1' }, { $set: { result: 'denied', reason: 'ROLE_SELF_CHANGE' } }],
    [{ _id: 'e2' }, {
      $set: { result: 'ok', before: { roleIds: [] }, after: { roleIds: ['r1'] } },
    }],
  ])
})

Deno.test('AuditRepository.searchEvents: newest first, and every filter that is given', async () => {
  const paginate = fn((_options: Record<string, unknown>) => Promise.resolve({ docs: [] }))
  const repo = buildRepository({ paginate })
  const from = new Date('2026-01-01')
  const to = new Date('2026-02-01')
  await repo.searchEvents({
    actor: 'a',
    targetKind: 'role',
    targetId: 'r1',
    action: 'roles.edit',
    result: 'ok',
    from,
    to,
    page: 2,
    limit: 5,
  })
  await repo.searchEvents({ from })
  await repo.searchEvents()
  assertEquals(paginate.calls[0][0], {
    page: 2,
    limit: 5,
    sort: { createdAt: -1 },
    filter: {
      actor: 'a',
      'target.kind': 'role',
      'target.id': 'r1',
      action: 'roles.edit',
      result: 'ok',
      createdAt: { $gte: from, $lte: to },
    },
  })
  assertEquals(paginate.calls[1][0].filter, { createdAt: { $gte: from } })
  assertEquals(paginate.calls[2][0].filter, {})
})
