import { assertEquals, assertInstanceOf } from 'jsr:@std/assert@0.224'
import { createIamClientRegistry } from '../../../sdk/client-registry.ts'
import { LoginClient } from '../../../sdk/client/login.client.ts'
import { OtpClient } from '../../../sdk/client/otp.client.ts'

Deno.test('createIamClientRegistry: builds real clients lazily, from the app-chosen base URL', () => {
  let resolved = 0
  const registry = createIamClientRegistry({
    baseUrl: () => {
      resolved++
      return 'https://iam.example.test/api'
    },
  })
  assertEquals(resolved, 0) // nothing resolved until a client is built
  assertInstanceOf(registry.getLoginClient(), LoginClient)
  assertInstanceOf(registry.getOtpClient(), OtpClient)
  assertEquals(resolved, 2)
})

Deno.test("createIamClientRegistry: a missing configuration fails at first use with the app's own error", () => {
  const registry = createIamClientRegistry({
    baseUrl: () => {
      throw new Error('IAM_BASE_URL is not configured')
    },
  })
  try {
    registry.getTotpClient()
    throw new Error('expected a throw')
  } catch (error) {
    assertEquals((error as Error).message, 'IAM_BASE_URL is not configured')
  }
})

Deno.test('createIamClientRegistry: set swaps a client, reset restores it, other clients are untouched', () => {
  const registry = createIamClientRegistry({ baseUrl: () => 'https://iam.example.test/api' })
  const fake = { fake: true } as unknown as LoginClient
  registry.setLoginClientFactory(() => fake)
  assertEquals(registry.getLoginClient(), fake)
  assertInstanceOf(registry.getOtpClient(), OtpClient)
  registry.resetLoginClientFactory()
  assertInstanceOf(registry.getLoginClient(), LoginClient)
})
