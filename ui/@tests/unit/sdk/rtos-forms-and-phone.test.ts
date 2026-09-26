import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'
import { classValidation } from '@zanix/validator'

import { EmailFormRTO, EntryFormRTO, ReactivationConfirmRTO } from '../../../sdk/rtos/login.ts'
import {
  AddPasswordRTO,
  OtpNotifierRTO,
  PhoneConfirmRTO,
  PhoneEnrollRTO,
} from '../../../sdk/rtos/password.ts'
import {
  PhoneEnrollRTO as ServerPhoneEnrollRTO,
} from '../../../../src/server/handlers/rtos/password.ts'

// deno-lint-ignore no-explicit-any
const validate = <T>(RTO: new (data: any) => T, payload: Record<string, unknown>) =>
  // deno-lint-ignore no-explicit-any
  classValidation(RTO as any, payload) as Promise<T>

Deno.test('EntryFormRTO: requires an email; the password is optional (passwordless accounts)', async () => {
  const withPassword = await validate(EntryFormRTO, { email: 'jane@example.com', password: 'p' })
  assertEquals([withPassword.email, withPassword.password], ['jane@example.com', 'p'])
  assertEquals((await validate(EntryFormRTO, { email: 'jane@example.com' })).password, undefined)
  await assertRejects(() => validate(EntryFormRTO, { email: 'jane' }), HttpError)
})

Deno.test('EmailFormRTO: requires a valid email', async () => {
  assertEquals(
    (await validate(EmailFormRTO, { email: 'jane@example.com' })).email,
    'jane@example.com',
  )
  await assertRejects(() => validate(EmailFormRTO, {}), HttpError)
})

Deno.test('ReactivationConfirmRTO: requires the reactivation token', async () => {
  const rto = await validate(ReactivationConfirmRTO, { reactivationToken: 'react-1' })
  assertEquals(rto.reactivationToken, 'react-1')
  await assertRejects(() => validate(ReactivationConfirmRTO, {}), HttpError)
})

Deno.test('AddPasswordRTO: requires the new password', async () => {
  assertEquals(
    (await validate(AddPasswordRTO, { newPassword: 'First1pass' })).newPassword,
    'First1pass',
  )
  await assertRejects(() => validate(AddPasswordRTO, {}), HttpError)
})

Deno.test('PhoneEnrollRTO/PhoneConfirmRTO: strip spaces, hyphens and parentheses before the E.164 check', async () => {
  assertEquals(
    (await validate(PhoneEnrollRTO, { phone: '+1 (415) 555-1234' })).phone,
    '+14155551234',
  )
  const confirm = await validate(PhoneConfirmRTO, { phone: '+44 20-7946-0958', code: '123456' })
  assertEquals([confirm.phone, confirm.code], ['+442079460958', '123456'])
  await assertRejects(() => validate(PhoneEnrollRTO, { phone: '0123' }), HttpError)
  await assertRejects(() => validate(PhoneConfirmRTO, { phone: '+14155551234' }), HttpError)
})

Deno.test('PhoneEnrollRTO: the SDK mirror normalizes and accepts/rejects exactly like the server RTO', async () => {
  for (const phone of ['+1 (415) 555-1234', '14155551234', '+0 123', 'call me', '']) {
    // deno-lint-ignore no-await-in-loop
    const [sdk, server] = await Promise.all([
      validate(PhoneEnrollRTO, { phone }).then((rto) => rto.phone, () => 'invalid'),
      validate(ServerPhoneEnrollRTO, { phone }).then((rto) => rto.phone, () => 'invalid'),
    ])
    assertEquals(sdk, server, `phone ${JSON.stringify(phone)}`)
  }
})

Deno.test("OtpNotifierRTO: accepts sms/whatsapp, '' and an omitted notifier; rejects 'email'", async () => {
  assertEquals((await validate(OtpNotifierRTO, { notifier: 'sms' })).notifier, 'sms')
  assertEquals((await validate(OtpNotifierRTO, { notifier: 'whatsapp' })).notifier, 'whatsapp')
  assertEquals((await validate(OtpNotifierRTO, { notifier: '' })).notifier, undefined)
  assertEquals((await validate(OtpNotifierRTO, {})).notifier, undefined)
  await assertRejects(() => validate(OtpNotifierRTO, { notifier: 'email' }), HttpError)
})
