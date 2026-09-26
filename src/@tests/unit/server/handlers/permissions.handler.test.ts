import { PermissionsController } from 'server/handlers/permissions.handler.ts'
import { assertDelegates } from '../../helpers/controller.ts'

Deno.test('PermissionsController: every route forwards its payload to the matching PermissionsService method', async () => {
  const body = { code: 'billing:invoice-read', name: 'Read invoices', description: 'Reads' }
  await assertDelegates(PermissionsController, [
    { method: 'create', payload: { body }, calls: 'createPermission', args: [body] },
    {
      method: 'search',
      payload: { search: { query: 'invoice' } },
      calls: 'getPermissions',
      args: [{ query: 'invoice' }],
    },
    {
      method: 'getById',
      payload: { params: { id: 'perm-1' } },
      calls: 'getPermissionById',
      args: ['perm-1'],
    },
    {
      method: 'update',
      payload: { params: { id: 'perm-1' }, body: { isActive: false } },
      calls: 'editPermission',
      args: ['perm-1', { isActive: false }],
    },
  ])
})
