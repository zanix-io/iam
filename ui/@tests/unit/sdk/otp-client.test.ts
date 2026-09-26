import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { RestClientError } from '@zanix/server'

import { OtpClient } from '../../../sdk/client/otp.client.ts'
import { bodyJson, withMockFetch } from './fetch-mock.ts'

const BASE_URL = 'https://iam.example.com'

Deno.test('OtpClient.request: gets login/otp/:email with the email URI-encoded', async () => {
  await withMockFetch([{ status: 200, body: { response: 'notification sent' } }], async (calls) => {
    const client = new OtpClient({ baseUrl: BASE_URL })
    const result = await client.request('user+test@example.com')
    assertEquals(calls[0].method, 'GET')
    assertEquals(
      calls[0].url,
      `${BASE_URL}/login/otp/${encodeURIComponent('user+test@example.com')}`,
    )
    assertEquals(result.response, 'notification sent')
  })
})

Deno.test('OtpClient.request: no account for the email surfaces a 403 RestClientError', async () => {
  await withMockFetch([{ status: 403 }], async () => {
    const client = new OtpClient({ baseUrl: BASE_URL })
    const error = await assertRejects(() => client.request('nobody@example.com'), RestClientError)
    assertEquals(error.realHttpStatus, 403)
  })
})

Deno.test('OtpClient.verify: posts email and code to login/otp/callback', async () => {
  await withMockFetch(
    [{ status: 200, body: { accessToken: 'a', refreshToken: 'r', expiresAt: 1 } }],
    async (calls) => {
      const client = new OtpClient({ baseUrl: BASE_URL })
      const result = await client.verify('user@example.com', '123456')
      assertEquals(calls[0].url, `${BASE_URL}/login/otp/callback`)
      assertEquals(bodyJson(calls[0]), { email: 'user@example.com', code: '123456' })
      if (!('accessToken' in result)) throw new Error('expected a session, got a challenge')
      assertEquals(result.accessToken, 'a')
    },
  )
})

Deno.test('OtpClient.verify: an invalid/expired code surfaces a 403 RestClientError', async () => {
  await withMockFetch([{ status: 403 }], async () => {
    const client = new OtpClient({ baseUrl: BASE_URL })
    await assertRejects(() => client.verify('user@example.com', '000000'), RestClientError)
  })
})

Deno.test('OtpClient.request: a notifier override is sent as the ?notifier= query parameter', async () => {
  const { OtpClient } = await import('../../../sdk/client/otp.client.ts')
  const { withMockFetch } = await import('./fetch-mock.ts')
  await withMockFetch([{ status: 200, body: { response: 'notification sent' } }], async (calls) => {
    await new OtpClient({ baseUrl: 'https://iam.example.com' }).request('a+b@example.com', 'sms')
    assertEquals(
      calls[0].url,
      `https://iam.example.com/login/otp/${encodeURIComponent('a+b@example.com')}?notifier=sms`,
    )
  })
})
