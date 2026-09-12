import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { classValidation } from '@zanix/validator'

import { OAUTH_PROVIDERS } from '../../../sdk/rtos/common.ts'
import {
  LoginRTO,
  OAuthLoginRTO,
  OAuthQueryRTO,
  OtpLoginRTO,
  TokenRTO,
  TotpLoginRTO,
} from '../../../sdk/rtos/login.ts'
import { PwdRecoveryCbRTO, PwdRTO, TotpConfirmRTO } from '../../../sdk/rtos/password.ts'

Deno.test('LoginRTO: accepts a valid email/password pair and exposes both fields', async () => {
  const rto = await classValidation(LoginRTO, { email: 'user@example.com', password: 'secret1A' })
  assertEquals(rto.email, 'user@example.com')
  assertEquals(rto.password, 'secret1A')
  assertEquals(JSON.parse(JSON.stringify(rto)), {
    email: 'user@example.com',
    password: 'secret1A',
  })
})

Deno.test('LoginRTO: rejects a malformed email', async () => {
  await assertRejects(() => classValidation(LoginRTO, { email: 'not-an-email', password: 'x' }))
})

Deno.test('TokenRTO: `token` is optional', async () => {
  const rto = await classValidation(TokenRTO, {})
  assertEquals(rto.token, undefined)
})

Deno.test('OAuthQueryRTO: accepts every real configured provider', async () => {
  const results = await Promise.all(
    OAUTH_PROVIDERS.map((oauth) => classValidation(OAuthQueryRTO, { oauth })),
  )
  results.forEach((rto, index) => assertEquals(rto.oauth, OAUTH_PROVIDERS[index]))
})

Deno.test('OAuthQueryRTO: rejects a provider `iam` never configures', async () => {
  await assertRejects(() => classValidation(OAuthQueryRTO, { oauth: 'facebook' }))
})

Deno.test('OAuthLoginRTO: exposes the authorization code', async () => {
  const rto = await classValidation(OAuthLoginRTO, { code: 'abc123' })
  assertEquals(rto.code, 'abc123')
})

Deno.test('OtpLoginRTO: requires both email and code', async () => {
  await assertRejects(() => classValidation(OtpLoginRTO, { email: 'user@example.com' }))
  const rto = await classValidation(OtpLoginRTO, { email: 'user@example.com', code: '123456' })
  assertEquals(rto.code, '123456')
})

Deno.test('TotpLoginRTO: requires both email and code', async () => {
  await assertRejects(() => classValidation(TotpLoginRTO, { code: '123456' }))
  const rto = await classValidation(TotpLoginRTO, { email: 'user@example.com', code: '123456' })
  assertEquals(rto.email, 'user@example.com')
})

Deno.test('PwdRTO: requires both currentPassword and newPassword', async () => {
  await assertRejects(() => classValidation(PwdRTO, { currentPassword: 'old1A' }))
  const rto = await classValidation(PwdRTO, {
    currentPassword: 'old1A',
    newPassword: 'new1A',
  })
  assertEquals(rto.newPassword, 'new1A')
})

Deno.test('PwdRecoveryCbRTO: requires email, password, and code together', async () => {
  const rto = await classValidation(PwdRecoveryCbRTO, {
    email: 'user@example.com',
    password: 'new1A',
    code: '123456',
  })
  assertEquals(rto.code, '123456')
  await assertRejects(() =>
    classValidation(PwdRecoveryCbRTO, { email: 'user@example.com', password: 'new1A' })
  )
})

Deno.test('TotpConfirmRTO: requires both secret and code', async () => {
  const rto = await classValidation(TotpConfirmRTO, { secret: 'JBSWY3DPEHPK3PXP', code: '123456' })
  assertEquals(rto.secret, 'JBSWY3DPEHPK3PXP')
  await assertRejects(() => classValidation(TotpConfirmRTO, { secret: 'JBSWY3DPEHPK3PXP' }))
})
