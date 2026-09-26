import { assertEquals } from 'jsr:@std/assert@0.224'
import { RecoveryCallbackFormRTO } from 'space/routes/[lang]/password/recovery/callback/callback-form.rto.ts'
import { assertInvalid, validate } from '../../helpers/rto.ts'

Deno.test('RecoveryCallbackFormRTO: requires email, code, password and its confirmation', async () => {
  const rto = await validate(RecoveryCallbackFormRTO, {
    email: 'jane@example.com',
    code: '123456',
    password: 'New1pass',
    confirmPassword: 'New1pass',
  })
  assertEquals(rto.confirmPassword, 'New1pass')
  await assertInvalid(RecoveryCallbackFormRTO, { email: 'jane' }, [
    'email',
    'code',
    'password',
    'confirmPassword',
  ])
})
