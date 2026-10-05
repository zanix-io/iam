import { assertEquals } from 'jsr:@std/assert@0.224'
import { SearchAuditRTO } from 'server/handlers/rtos/audit.ts'
import { assertInvalid, validate } from '../../../helpers/rto.ts'

Deno.test('SearchAuditRTO: every filter is optional', async () => {
  const rto = await validate(SearchAuditRTO, {})
  assertEquals([rto.actor, rto.action, rto.result, rto.from, rto.to], [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ])
})

Deno.test('SearchAuditRTO: accepts a known kind, result, action and ISO dates', async () => {
  const rto = await validate(SearchAuditRTO, {
    actor: 'auth-1',
    targetKind: 'permission',
    targetId: 'p1',
    action: 'roles.add',
    result: 'conflict',
    from: '2026-01-01',
    to: '2026-02-01T10:00:00Z',
  })
  assertEquals([rto.targetKind, rto.result, rto.from, rto.to], [
    'permission',
    'conflict',
    '2026-01-01',
    '2026-02-01T10:00:00Z',
  ])
})

Deno.test('SearchAuditRTO: rejects an unknown kind or result, a malformed action and a non-ISO date', async () => {
  await assertInvalid(SearchAuditRTO, { targetKind: 'planet' }, ['targetKind'])
  await assertInvalid(SearchAuditRTO, { result: 'maybe' }, ['result'])
  await assertInvalid(SearchAuditRTO, { action: 'ROLES ADD' }, ['action'])
  await assertInvalid(SearchAuditRTO, { from: 'yesterday', to: '01/02/2026' }, ['from', 'to'])
})
