import { RolesController } from 'server/handlers/roles.handler.ts'
import { assertDelegates } from '../../helpers/controller.ts'

Deno.test('RolesController: every route forwards its payload to the matching RolesService method', async () => {
  const body = { name: 'Editor', code: 'editor', description: 'Edits', permissions: [] }
  await assertDelegates(RolesController, [
    { method: 'create', payload: { body }, calls: 'createRole', args: [body] },
    {
      method: 'search',
      payload: { search: { query: 'edit' } },
      calls: 'getRoles',
      args: [{ query: 'edit' }],
    },
    {
      method: 'getById',
      payload: { params: { id: 'role-1' } },
      calls: 'getRoleById',
      args: ['role-1'],
    },
    {
      method: 'update',
      payload: { params: { id: 'role-1' }, body: { name: 'Renamed' } },
      calls: 'editRole',
      args: ['role-1', { name: 'Renamed' }],
    },
    {
      method: 'remove',
      payload: { params: { id: 'role-1' } },
      calls: 'deleteRole',
      args: ['role-1'],
    },
    {
      method: 'assign',
      payload: { body: { authId: 'auth-1', roleId: 'role-1' } },
      calls: 'assignRole',
      args: [{ authId: 'auth-1', roleId: 'role-1' }],
    },
  ])
})
