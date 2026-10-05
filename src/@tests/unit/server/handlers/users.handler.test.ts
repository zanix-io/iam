import { UsersController } from 'server/handlers/users.handler.ts'
import { assertDelegates } from '../../helpers/controller.ts'

Deno.test('UsersController: every route forwards its payload to the matching UsersService method', async () => {
  const body = { firstName: 'Jane' }
  await assertDelegates(UsersController, [
    {
      method: 'register',
      payload: { body: { email: 'jane@example.com' } },
      calls: 'registerUser',
      args: [{ email: 'jane@example.com' }],
    },
    { method: 'getOwnProfile', calls: 'getOwnProfile', args: [] },
    { method: 'updateOwnProfile', payload: { body }, calls: 'updateOwnProfile', args: [body] },
    { method: 'deactivateOwnAccount', calls: 'deactivateOwnAccount', args: [] },
    { method: 'deleteOwnAccount', calls: 'deleteOwnAccount', args: [] },
    {
      method: 'search',
      payload: { search: { query: 'jane', status: 'ACTIVE' } },
      calls: 'searchUsers',
      args: [{ query: 'jane', status: 'ACTIVE' }],
    },
    {
      method: 'lookup',
      payload: { search: { email: 'jane@example.com' } },
      calls: 'lookupUserByEmail',
      args: ['jane@example.com'],
    },
    {
      method: 'getById',
      payload: { params: { id: 'user-1' } },
      calls: 'getUserById',
      args: ['user-1'],
    },
    {
      method: 'updateById',
      payload: { params: { id: 'user-1' }, body: { status: 'INACTIVE' } },
      calls: 'updateUserById',
      args: ['user-1', { status: 'INACTIVE' }],
    },
  ])
})
