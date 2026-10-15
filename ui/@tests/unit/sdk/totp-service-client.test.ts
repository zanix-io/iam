import { assertEquals, assertInstanceOf, assertRejects } from 'jsr:@std/assert@0.224'
import { RestClientError } from '@zanix/server'

import { TotpServiceClient } from '../../../sdk/client/totp-service.client.ts'
import { createIamClientRegistry } from '../../../sdk/client-registry.ts'
import { bodyJson, withMockFetch } from './fetch-mock.ts'

const BASE_URL = 'https://iam.example.com/api'
const AUTH_ID = 'a'.repeat(24)
const HEADERS = { 'X-Znx-Authorization': 'Bearer service-token' }

function client(exchanged: string[] = []) {
  return new TotpServiceClient({
    baseUrl: `${BASE_URL}/`,
    serviceAuth: (url) => {
      exchanged.push(url)
      return Promise.resolve(HEADERS)
    },
  })
}

Deno.test('TotpServiceClient.lookupAccount: posts the email in the body with the service credential', async () => {
  const found = {
    authId: AUTH_ID,
    userId: 'u1',
    status: 'ACTIVE',
    hasTotp: true,
    backupCodesRemaining: 3,
  }
  await withMockFetch([{ status: 200, body: found }], async (calls) => {
    const exchanged: string[] = []
    assertEquals(await client(exchanged).lookupAccount('person@example.com'), found)
    assertEquals([calls[0].method, calls[0].url], [
      'POST',
      `${BASE_URL}/admin/service/accounts/lookup`,
    ])
    assertEquals(calls[0].headers.get('X-Znx-Authorization'), 'Bearer service-token')
    assertEquals(calls[0].headers.get('Authorization'), null)
    assertEquals(bodyJson(calls[0]), { email: 'person@example.com' })
    assertEquals(exchanged, [`${BASE_URL}/admin/service/token`])
  })
})

Deno.test('TotpServiceClient.resetTotp: posts the account, reason and operator id in the body', async () => {
  await withMockFetch([{ status: 200, body: { response: 'TOTP reset' } }], async (calls) => {
    const result = await client().resetTotp({
      authId: AUTH_ID,
      reason: 'Lost phone',
      operatorId: 'staff-42',
    })
    assertEquals(result.response, 'TOTP reset')
    assertEquals([calls[0].method, calls[0].url], ['POST', `${BASE_URL}/admin/service/totp/reset`])
    assertEquals(calls[0].headers.get('X-Znx-Authorization'), 'Bearer service-token')
    assertEquals(bodyJson(calls[0]), {
      authId: AUTH_ID,
      reason: 'Lost phone',
      operator: { id: 'staff-42' },
    })
  })
})

Deno.test('TotpServiceClient: a refusal surfaces as a RestClientError with the upstream status', async () => {
  for (const status of [400, 403, 404, 409, 429]) {
    // deno-lint-ignore no-await-in-loop
    await withMockFetch([{ status }, { status }], async () => {
      for (
        const call of [
          () => client().lookupAccount('person@example.com'),
          () => client().resetTotp({ authId: AUTH_ID, reason: 'r', operatorId: 'op' }),
        ]
      ) {
        // deno-lint-ignore no-await-in-loop
        const error = await assertRejects(call, RestClientError)
        assertEquals(error.realHttpStatus, status)
      }
    })
  }
})

Deno.test('TotpServiceClient.listResets: gets admin/service/totp/resets with the filters in the query', async () => {
  const page = { total: 0, page: 1, limit: 20, docs: [] }
  await withMockFetch([{ status: 200, body: page }, { status: 200, body: page }], async (calls) => {
    assertEquals(await client().listResets(), page)
    await client().listResets({ authId: AUTH_ID, page: 2, limit: 5 })
    assertEquals([calls[0].method, calls[0].url], ['GET', `${BASE_URL}/admin/service/totp/resets`])
    assertEquals(calls[0].headers.get('X-Znx-Authorization'), 'Bearer service-token')
    assertEquals(
      calls[1].url,
      `${BASE_URL}/admin/service/totp/resets?authId=${AUTH_ID}&page=2&limit=5`,
    )
  })
})

Deno.test('createIamClientRegistry: the service client is built with the registry serviceAuth, and fails clearly without one', () => {
  const registry = createIamClientRegistry({
    baseUrl: () => BASE_URL,
    serviceAuth: () => Promise.resolve(HEADERS),
  })
  assertInstanceOf(registry.getTotpServiceClient(), TotpServiceClient)
  const fake = { fake: true } as unknown as TotpServiceClient
  registry.setTotpServiceClientFactory(() => fake)
  assertEquals(registry.getTotpServiceClient(), fake)
  registry.resetTotpServiceClientFactory()
  assertInstanceOf(registry.getTotpServiceClient(), TotpServiceClient)

  const without = createIamClientRegistry({ baseUrl: () => BASE_URL })
  try {
    without.getTotpServiceClient()
    throw new Error('expected a throw')
  } catch (error) {
    assertEquals((error as Error).message.includes('serviceAuth'), true)
  }
})
