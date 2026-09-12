import { assertEquals } from 'jsr:@std/assert@0.224'

import { IAM_UI_MESSAGES_EN } from '../../../sdk/messages/en.ts'

Deno.test('IAM_UI_MESSAGES_EN: every value is a non-empty string', () => {
  for (const [key, value] of Object.entries(IAM_UI_MESSAGES_EN)) {
    assertEquals(typeof value, 'string', `expected ${key} to be a string`)
    assertEquals(value.length > 0, true, `expected ${key} to be non-empty`)
  }
})

Deno.test("IAM_UI_MESSAGES_EN: excludes consent — out of this SDK's REST-API scope", () => {
  const consentKeys = Object.keys(IAM_UI_MESSAGES_EN).filter((key) => key.startsWith('consent/'))
  assertEquals(consentKeys, [])
})

Deno.test('IAM_UI_MESSAGES_EN: carries the real login/otp/totp/password-recovery keys', () => {
  for (
    const key of [
      'login/submit',
      'login/otp/heading',
      'login/totp/heading',
      'totp/enroll/heading',
      'password/recovery/submit',
    ]
  ) {
    assertEquals(key in IAM_UI_MESSAGES_EN, true, `expected ${key} to be present`)
  }
})
