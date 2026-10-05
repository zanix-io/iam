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
    {
      method: 'holders',
      payload: { params: { id: 'role-1' }, search: { page: 2, limit: 5, sortBy: { _id: 1 } } },
      calls: 'getRoleHolders',
      args: ['role-1', { page: 2, limit: 5 }],
    },
    {
      method: 'getAccountPermissions',
      payload: { params: { authId: 'auth-1' } },
      calls: 'getAccountPermissions',
      args: ['auth-1'],
    },
    {
      method: 'add',
      payload: { body: { authId: 'auth-1', roleIds: ['role-1'] } },
      calls: 'addRoles',
      args: [{ authId: 'auth-1', roleIds: ['role-1'] }],
    },
    {
      method: 'removeFromAccount',
      payload: { body: { authId: 'auth-1', roleIds: ['role-1'] } },
      calls: 'removeRoles',
      args: [{ authId: 'auth-1', roleIds: ['role-1'] }],
    },
    {
      method: 'getAccountRoles',
      payload: { params: { authId: 'auth-1' } },
      calls: 'getAccountRoles',
      args: ['auth-1'],
    },
    {
      method: 'setAccountRoles',
      payload: { params: { authId: 'auth-1' }, body: { roleIds: ['role-1'] } },
      calls: 'setRoles',
      args: ['auth-1', ['role-1']],
    },
  ])
})
