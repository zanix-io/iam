import { assertEquals, assertNotEquals } from 'jsr:@std/assert@0.224'

import { validateEmail } from '../../../sdk/validation/email.ts'
import { validatePassword } from '../../../sdk/validation/password.ts'
import { validateVerificationCode } from '../../../sdk/validation/code.ts'

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
