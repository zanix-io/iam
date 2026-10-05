import { AuditController } from 'server/handlers/audit.handler.ts'
import { assertDelegates } from '../../helpers/controller.ts'

Deno.test('AuditController: search forwards the query to AuditService.searchEvents', async () => {
  const search = { actor: 'auth-1', action: 'roles.add', from: '2026-01-01', page: 2 }
  await assertDelegates(AuditController, [
    { method: 'search', payload: { search }, calls: 'searchEvents', args: [search] },
  ])
})
