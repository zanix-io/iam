import { StepUpController } from 'server/handlers/step-up.handler.ts'
import { assertDelegates } from '../../helpers/controller.ts'

Deno.test('StepUpController: every route forwards its payload to the matching StepUpService method', async () => {
  await assertDelegates(StepUpController, [
    {
      method: 'request',
      payload: { body: { purpose: 'wallet-transfer' } },
      calls: 'request',
      args: ['wallet-transfer'],
    },
    {
      method: 'verify',
      payload: { body: { purpose: 'wallet-transfer', code: '123456', bind: 'tx-42' } },
      calls: 'verify',
      args: ['wallet-transfer', '123456', 'tx-42'],
    },
    {
      method: 'verify',
      payload: { body: { purpose: 'wallet-transfer', code: '123456' } },
      calls: 'verify',
      args: ['wallet-transfer', '123456', undefined],
    },
  ])
})
