import { assertEquals, assertNotEquals } from 'jsr:@std/assert@0.224'

import { validateEmail } from '../../../sdk/validation/email.ts'
import { validatePassword } from '../../../sdk/validation/password.ts'
import { validateTotpOrBackupCode, validateVerificationCode } from '../../../sdk/validation/code.ts'

Deno.test('validateEmail: accepts a well-formed address', () => {
  assertEquals(validateEmail('user@example.com'), true)
})

Deno.test('validateEmail: rejects an empty value', () => {
  assertNotEquals(validateEmail(''), true)
})

Deno.test('validateEmail: rejects a malformed address', () => {
  assertNotEquals(validateEmail('not-an-email'), true)
})

Deno.test('validatePassword: accepts a password satisfying every rule', () => {
  assertEquals(validatePassword('Secret1A'), true)
})

Deno.test('validatePassword: rejects fewer than 8 characters', () => {
  assertNotEquals(validatePassword('Sec1A'), true)
})

Deno.test('validatePassword: rejects no uppercase letter', () => {
  assertNotEquals(validatePassword('secret1a'), true)
})

Deno.test('validatePassword: rejects no digit', () => {
  assertNotEquals(validatePassword('SecretAbcd'), true)
})

Deno.test('validateVerificationCode: accepts a 6-digit code', () => {
  assertEquals(validateVerificationCode('123456'), true)
})

Deno.test('validateVerificationCode: rejects an empty value', () => {
  assertNotEquals(validateVerificationCode(''), true)
})

Deno.test('validateVerificationCode: rejects a code that is not exactly 6 digits', () => {
  assertNotEquals(validateVerificationCode('12345'), true)
  assertNotEquals(validateVerificationCode('1234567'), true)
  assertNotEquals(validateVerificationCode('12a456'), true)
})

Deno.test('validateTotpOrBackupCode: accepts a 6-digit code or a well-formed backup code in any case', () => {
  for (const code of ['123456', 'ABCDE-FGHJK', 'abcde-fghjk', 'abcde fghjk', 'ABCDEFGHJK']) {
    assertEquals(validateTotpOrBackupCode(code), true, code)
  }
})

Deno.test('validateTotpOrBackupCode: asks for a code when empty and rejects anything else with one message', () => {
  assertEquals(validateTotpOrBackupCode(''), 'Enter your verification code.')
  for (const code of ['12345', '1234567', 'ABCDE-FGHJ', 'ABCDE-FGHJ0', 'ABCDE-FGHJI']) {
    assertEquals(validateTotpOrBackupCode(code), 'Enter the 6-digit code or a backup code.', code)
  }
})
