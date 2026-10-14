import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { RestClientError } from '@zanix/server'

import { TotpAdminClient } from '../../../sdk/client/totp-admin.client.ts'
import { TOTP_RESET_REASON_MAX, TotpResetRTO } from '../../../sdk/rtos/totp-admin.ts'
import { bodyJson, withMockFetch } from './fetch-mock.ts'
import { classValidation } from '@zanix/validator'

const BASE_URL = 'https://iam.example.com'
const TOKEN = 'operator-access-token'
const AUTH_ID = 'a'.repeat(24)

Deno.test('TotpAdminClient.resetTotp: posts the account and the reason in the body, never in the URL', async () => {
  await withMockFetch([{ status: 200, body: { response: 'TOTP reset' } }], async (calls) => {
    const result = await new TotpAdminClient({ baseUrl: BASE_URL }).resetTotp(
      TOKEN,
      AUTH_ID,
      'Lost phone, checked by call',
    )
    assertEquals([calls[0].method, calls[0].url], ['POST', `${BASE_URL}/admin/totp/reset`])
    assertEquals(calls[0].headers.get('Authorization'), `Bearer ${TOKEN}`)
    assertEquals(bodyJson(calls[0]), { authId: AUTH_ID, reason: 'Lost phone, checked by call' })
    assertEquals(result.response, 'TOTP reset')
  })
})

Deno.test('TotpAdminClient.resetTotp: a refusal surfaces as a RestClientError', async () => {
  for (const status of [403, 404, 409]) {
    // deno-lint-ignore no-await-in-loop
    await withMockFetch([{ status }], async () => {
      const error = await assertRejects(
        () => new TotpAdminClient({ baseUrl: BASE_URL }).resetTotp(TOKEN, AUTH_ID, 'Lost phone'),
        RestClientError,
      )
      assertEquals(error.realHttpStatus, status)
    })
  }
})

Deno.test('TotpAdminClient.listResets: gets admin/totp/resets with the operator bearer and the filters in the query', async () => {
  const page = { total: 0, page: 1, limit: 20, docs: [] }
  await withMockFetch([{ status: 200, body: page }, { status: 200, body: page }], async (calls) => {
    const client = new TotpAdminClient({ baseUrl: BASE_URL })
    assertEquals(await client.listResets(TOKEN), page)
    await client.listResets(TOKEN, { authId: AUTH_ID, page: 2, limit: 5 })
    assertEquals([calls[0].method, calls[0].url], ['GET', `${BASE_URL}/admin/totp/resets`])
    assertEquals(calls[0].headers.get('Authorization'), `Bearer ${TOKEN}`)
    assertEquals(
      calls[1].url,
      `${BASE_URL}/admin/totp/resets?authId=${AUTH_ID}&page=2&limit=5`,
    )
  })
})

Deno.test('TotpResetRTO: mirrors the server rule, the reason is trimmed and 1 to 200 characters', async () => {
  const ok = await classValidation(TotpResetRTO, { authId: AUTH_ID, reason: '  Lost phone ' })
  assertEquals(ok.reason, 'Lost phone')
  assertEquals(TOTP_RESET_REASON_MAX, 200)
  for (const reason of ['', '   ', 'x'.repeat(201), 'bad\u0000']) {
    // deno-lint-ignore no-await-in-loop
    await assertRejects(() => classValidation(TotpResetRTO, { authId: AUTH_ID, reason }))
  }
})
