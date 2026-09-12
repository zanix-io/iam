import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { RestClientError } from '@zanix/server'

import { PasswordClient } from '../../../sdk/client/password.client.ts'
import { bodyJson, withMockFetch } from './fetch-mock.ts'

const BASE_URL = 'https://iam.example.com'

Deno.test('PasswordClient.change: posts both passwords with a bearer header', async () => {
  await withMockFetch([{ status: 200, body: { response: 'password changed' } }], async (calls) => {
    const client = new PasswordClient({ baseUrl: BASE_URL })
    const result = await client.change('access-token-value', 'oldPass1', 'newPass1')
    assertEquals(calls[0].url, `${BASE_URL}/pwd/change`)
    assertEquals(calls[0].headers.get('Authorization'), 'Bearer access-token-value')
    assertEquals(bodyJson(calls[0]), {
      currentPassword: 'oldPass1',
      newPassword: 'newPass1',
    })
    assertEquals(result.response, 'password changed')
  })
})

Deno.test('PasswordClient.change: the wrong current password surfaces a 403 RestClientError', async () => {
  await withMockFetch([{ status: 403 }], async () => {
    const client = new PasswordClient({ baseUrl: BASE_URL })
    const error = await assertRejects(
      () => client.change('access-token-value', 'wrong', 'newPass1'),
      RestClientError,
    )
    assertEquals(error.realHttpStatus, 403)
  })
})

Deno.test('PasswordClient.requestRecovery: gets pwd/recovery/:email with the email URI-encoded', async () => {
  await withMockFetch([{ status: 200, body: { response: 'notification sent' } }], async (calls) => {
    const client = new PasswordClient({ baseUrl: BASE_URL })
    await client.requestRecovery('user+test@example.com')
    assertEquals(
      calls[0].url,
      `${BASE_URL}/pwd/recovery/${encodeURIComponent('user+test@example.com')}`,
    )
  })
})

Deno.test('PasswordClient.confirmRecovery: posts email, code, and the new password', async () => {
  await withMockFetch(
    [{ status: 200, body: { accessToken: 'a', refreshToken: 'r', expiresAt: 1 } }],
    async (calls) => {
      const client = new PasswordClient({ baseUrl: BASE_URL })
      const result = await client.confirmRecovery('user@example.com', '123456', 'newPass1')
      assertEquals(calls[0].url, `${BASE_URL}/pwd/recovery/callback`)
      assertEquals(bodyJson(calls[0]), {
        email: 'user@example.com',
        code: '123456',
        password: 'newPass1',
      })
      assertEquals(result.accessToken, 'a')
    },
  )
})

Deno.test('PasswordClient.confirmRecovery: an invalid/expired code surfaces a 403 RestClientError', async () => {
  await withMockFetch([{ status: 403 }], async () => {
    const client = new PasswordClient({ baseUrl: BASE_URL })
    await assertRejects(
      () => client.confirmRecovery('user@example.com', '000000', 'newPass1'),
      RestClientError,
    )
  })
})
