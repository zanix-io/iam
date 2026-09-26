import { assertEquals } from 'jsr:@std/assert@0.224'
import {
  LoginOtpSearchRTO,
  LoginRTO,
  OAuthAuthorizeSearchRTO,
  OAuthLoginRTO,
  OAuthQueryRTO,
  OtpLoginRTO,
  ReactivationConfirmRTO,
  TokenRTO,
  TotpLoginRTO,
} from 'server/handlers/rtos/login.ts'
import { assertInvalid, validate } from '../../../helpers/rto.ts'

Deno.test('LoginRTO: requires a valid email and a password', async () => {
  const rto = await validate(LoginRTO, { email: 'jane@example.com', password: 'secret' })
  assertEquals([rto.email, rto.password], ['jane@example.com', 'secret'])
  await assertInvalid(LoginRTO, { email: 'not-an-email' }, ['email', 'password'])
})

Deno.test('TokenRTO: token is optional (the refresh cookie can carry it instead)', async () => {
  assertEquals((await validate(TokenRTO, {})).token, undefined)
  assertEquals((await validate(TokenRTO, { token: 'refresh' })).token, 'refresh')
  await assertInvalid(TokenRTO, { token: 42 }, ['token'])
})

Deno.test('OAuthQueryRTO: accepts only the supported OAuth2 providers', async () => {
  assertEquals((await validate(OAuthQueryRTO, { oauth: 'google' })).oauth, 'google')
  assertEquals((await validate(OAuthQueryRTO, { oauth: 'github' })).oauth, 'github')
  await assertInvalid(OAuthQueryRTO, { oauth: 'facebook' }, ['oauth'])
})

Deno.test('OAuthAuthorizeSearchRTO: email is optional but must be an email when given', async () => {
  assertEquals((await validate(OAuthAuthorizeSearchRTO, {})).email, undefined)
  await assertInvalid(OAuthAuthorizeSearchRTO, { email: 'jane' }, ['email'])
})

Deno.test('OAuthLoginRTO: requires the provider authorization code', async () => {
  assertEquals((await validate(OAuthLoginRTO, { code: 'abc' })).code, 'abc')
  await assertInvalid(OAuthLoginRTO, {}, ['code'])
})

Deno.test('LoginOtpSearchRTO: notifier is optional and limited to the supported channels', async () => {
  assertEquals((await validate(LoginOtpSearchRTO, {})).notifier, undefined)
  assertEquals((await validate(LoginOtpSearchRTO, { notifier: 'sms' })).notifier, 'sms')
  await assertInvalid(LoginOtpSearchRTO, { notifier: 'pigeon' }, ['notifier'])
})

Deno.test('OtpLoginRTO/TotpLoginRTO: require an email and a code', async () => {
  for (const RTO of [OtpLoginRTO, TotpLoginRTO]) {
    // deno-lint-ignore no-await-in-loop
    const rto = await validate(RTO, { email: 'jane@example.com', code: '123456' })
    assertEquals([rto.email, rto.code], ['jane@example.com', '123456'])
    // deno-lint-ignore no-await-in-loop
    await assertInvalid(RTO, { email: 'jane' }, ['email', 'code'])
  }
})

Deno.test('ReactivationConfirmRTO: requires the reactivation token', async () => {
  const rto = await validate(ReactivationConfirmRTO, { reactivationToken: 'token' })
  assertEquals(rto.reactivationToken, 'token')
  await assertInvalid(ReactivationConfirmRTO, {}, ['reactivationToken'])
})
