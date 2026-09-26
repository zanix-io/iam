import { GrantAccessController } from 'server/handlers/grant-access.handler.ts'
import { assertDelegates } from '../../helpers/controller.ts'

Deno.test('GrantAccessController: every route forwards its payload to the matching GrantAccessService method', async () => {
  const grant = { userId: 'user-1', resourceId: 'billing:reports', accessLevel: 'read' }
  await assertDelegates(GrantAccessController, [
    { method: 'create', payload: { body: grant }, calls: 'createGrant', args: [grant] },
    {
      method: 'search',
      payload: { search: { userId: 'user-1' } },
      calls: 'getGrants',
      args: [{ userId: 'user-1' }],
    },
    { method: 'check', payload: { search: grant }, calls: 'checkAccess', args: [grant] },
    {
      method: 'getById',
      payload: { params: { id: 'grant-1' } },
      calls: 'getGrantById',
      args: ['grant-1'],
    },
    {
      method: 'update',
      payload: { params: { id: 'grant-1' }, body: { isActive: false } },
      calls: 'editGrant',
      args: ['grant-1', { isActive: false }],
    },
    {
      method: 'remove',
      payload: { params: { id: 'grant-1' } },
      calls: 'revokeGrant',
      args: ['grant-1'],
    },
  ])
})
