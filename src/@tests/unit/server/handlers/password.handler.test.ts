import { PasswordController } from 'server/handlers/password.handler.ts'
import { assertDelegates } from '../../helpers/controller.ts'

Deno.test('PasswordController: every route forwards its payload to the matching PasswordService method', async () => {
  await assertDelegates(PasswordController, [
    {
      method: 'change',
      payload: { body: { currentPassword: 'OldPass1', newPassword: 'NewPass1' } },
      calls: 'changePwd',
      args: ['OldPass1', 'NewPass1'],
    },
    {
      method: 'add',
      payload: { body: { newPassword: 'FirstPass1' } },
      calls: 'addPassword',
      args: ['FirstPass1'],
    },
    { method: 'remove', calls: 'removePassword', args: [] },
    {
      method: 'recovery',
      payload: { params: { email: 'jane@example.com' } },
      calls: 'recovery',
      args: ['jane@example.com'],
    },
    {
      method: 'recoveryCallback',
      payload: { body: { email: 'jane@example.com', code: '123456', password: 'NewPass1' } },
      calls: 'recoveryCallback',
      args: ['jane@example.com', '123456', 'NewPass1'],
    },
  ])
})
