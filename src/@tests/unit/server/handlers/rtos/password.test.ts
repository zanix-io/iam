import { assertEquals } from 'jsr:@std/assert@0.224'
import {
  AddPasswordRTO,
  OtpNotifierRTO,
  PhoneConfirmRTO,
  PhoneEnrollRTO,
  PwdRecoveryCbRTO,
  PwdRecoveryRTO,
  PwdRTO,
  TotpConfirmRTO,
} from 'server/handlers/rtos/password.ts'
import { assertInvalid, validate } from '../../../helpers/rto.ts'

Deno.test('PwdRTO: requires the current and the new password', async () => {
  const rto = await validate(PwdRTO, { currentPassword: 'Old1pass', newPassword: 'New1pass' })
  assertEquals([rto.currentPassword, rto.newPassword], ['Old1pass', 'New1pass'])
  await assertInvalid(PwdRTO, {}, ['currentPassword', 'newPassword'])
})

Deno.test('AddPasswordRTO: requires only the new password', async () => {
  assertEquals(
    (await validate(AddPasswordRTO, { newPassword: 'New1pass' })).newPassword,
    'New1pass',
  )
  await assertInvalid(AddPasswordRTO, {}, ['newPassword'])
})

Deno.test('PwdRecoveryRTO: URI-decodes an encoded email route param', async () => {
  const rto = await validate(PwdRecoveryRTO, { email: 'jane%2Btag%40example.com' })
  assertEquals(rto.email, 'jane+tag@example.com')
})

Deno.test('PwdRecoveryRTO: a malformed percent-encoding falls back to the raw value, then validates it', async () => {
  // `decodeURIComponent('%E0%A4%A')` throws a URIError; the raw string is kept and validated as-is.
  await assertInvalid(PwdRecoveryRTO, { email: '%E0%A4%A' }, ['email'])
})

Deno.test('PwdRecoveryRTO: rejects a non-email value', async () => {
  await assertInvalid(PwdRecoveryRTO, { email: 'jane' }, ['email'])
})

Deno.test('PwdRecoveryCbRTO: requires email, password and code', async () => {
  const rto = await validate(PwdRecoveryCbRTO, {
    email: 'jane@example.com',
    password: 'New1pass',
    code: '123456',
  })
  assertEquals([rto.email, rto.password, rto.code], ['jane@example.com', 'New1pass', '123456'])
  await assertInvalid(PwdRecoveryCbRTO, { email: 'jane' }, ['email', 'password', 'code'])
})

Deno.test('TotpConfirmRTO: requires the secret and the code', async () => {
  const rto = await validate(TotpConfirmRTO, { secret: 'SECRET', code: '123456' })
  assertEquals([rto.secret, rto.code], ['SECRET', '123456'])
  await assertInvalid(TotpConfirmRTO, {}, ['secret', 'code'])
})

Deno.test('PhoneEnrollRTO: strips spaces, hyphens and parentheses before the E.164 check', async () => {
  assertEquals(
    (await validate(PhoneEnrollRTO, { phone: '+1 (415) 555-1234' })).phone,
    '+14155551234',
  )
})

Deno.test('PhoneEnrollRTO: rejects a value that is not E.164 after normalization', async () => {
  await assertInvalid(PhoneEnrollRTO, { phone: '0123' }, ['phone'])
  await assertInvalid(PhoneEnrollRTO, { phone: 'call me' }, ['phone'])
})

Deno.test('PhoneConfirmRTO: normalizes the phone and requires the code', async () => {
  const rto = await validate(PhoneConfirmRTO, { phone: '+44 20-7946-0958', code: '123456' })
  assertEquals([rto.phone, rto.code], ['+442079460958', '123456'])
  await assertInvalid(PhoneConfirmRTO, { phone: '+44 20-7946-0958' }, ['code'])
})

Deno.test("OtpNotifierRTO: accepts sms/whatsapp, '' and an omitted notifier; never 'email'", async () => {
  assertEquals((await validate(OtpNotifierRTO, { notifier: 'sms' })).notifier, 'sms')
  assertEquals((await validate(OtpNotifierRTO, { notifier: 'whatsapp' })).notifier, 'whatsapp')
  // `''` (an HTML select's "email" option) is accepted and resolves to no notifier, the same
  // "reset to email" input `AuthService.setOtpNotifier` receives for an omitted field.
  assertEquals((await validate(OtpNotifierRTO, { notifier: '' })).notifier, undefined)
  assertEquals((await validate(OtpNotifierRTO, {})).notifier, undefined)
  await assertInvalid(OtpNotifierRTO, { notifier: 'email' }, ['notifier'])
})

Deno.test('PhoneEnrollRTO: a missing phone normalizes to an empty string and is rejected', async () => {
  await assertInvalid(PhoneEnrollRTO, {}, ['phone'])
})

Deno.test('PwdRecoveryRTO: constructed directly (as the route param pipe does), exposes the decoded email', () => {
  assertEquals(
    new PwdRecoveryRTO({ email: 'jane%40example.com' } as never).email,
    'jane@example.com',
  )
})
