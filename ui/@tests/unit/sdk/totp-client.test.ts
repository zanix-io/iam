import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { RestClientError } from '@zanix/server'

import { TotpClient } from '../../../sdk/client/totp.client.ts'
import { bodyJson, withMockFetch } from './fetch-mock.ts'

const BASE_URL = 'https://iam.example.com'

Deno.test('TotpClient.verifyLogin: posts email and code to login/totp/callback', async () => {
  await withMockFetch(
    [{ status: 200, body: { accessToken: 'a', refreshToken: 'r', expiresAt: 1 } }],
    async (calls) => {
      const client = new TotpClient({ baseUrl: BASE_URL })
      const result = await client.verifyLogin('user@example.com', '654321')
      assertEquals(calls[0].url, `${BASE_URL}/login/totp/callback`)
      assertEquals(bodyJson(calls[0]), { email: 'user@example.com', code: '654321' })
      assertEquals(result.accessToken, 'a')
    },
  )
})

Deno.test('TotpClient.enroll: gets login/totp/enroll with a bearer header', async () => {
  await withMockFetch(
    [{ status: 200, body: { secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/...' } }],
    async (calls) => {
      const client = new TotpClient({ baseUrl: BASE_URL })
      const result = await client.enroll('access-token-value')
      assertEquals(calls[0].method, 'GET')
      assertEquals(calls[0].url, `${BASE_URL}/login/totp/enroll`)
      assertEquals(calls[0].headers.get('Authorization'), 'Bearer access-token-value')
      assertEquals(result.secret, 'JBSWY3DPEHPK3PXP')
    },
  )
})

Deno.test('TotpClient.enroll: no session surfaces a 401 RestClientError', async () => {
  await withMockFetch([{ status: 401 }], async () => {
    const client = new TotpClient({ baseUrl: BASE_URL })
    const error = await assertRejects(() => client.enroll(''), RestClientError)
    assertEquals(error.realHttpStatus, 401)
  })
})

Deno.test('TotpClient.confirmEnrollment: posts secret and code with a bearer header', async () => {
  await withMockFetch([{ status: 200, body: { response: 'TOTP enabled' } }], async (calls) => {
    const client = new TotpClient({ baseUrl: BASE_URL })
    const result = await client.confirmEnrollment(
      'access-token-value',
      'JBSWY3DPEHPK3PXP',
      '654321',
    )
    assertEquals(calls[0].url, `${BASE_URL}/login/totp/confirm`)
    assertEquals(calls[0].headers.get('Authorization'), 'Bearer access-token-value')
    assertEquals(bodyJson(calls[0]), { secret: 'JBSWY3DPEHPK3PXP', code: '654321' })
    assertEquals(result.response, 'TOTP enabled')
  })
})

Deno.test('TotpClient.disable: deletes login/totp with a bearer header', async () => {
  await withMockFetch([{ status: 200, body: { response: 'TOTP disabled' } }], async (calls) => {
    const client = new TotpClient({ baseUrl: BASE_URL })
    const result = await client.disable('access-token-value')
    assertEquals(calls[0].method, 'DELETE')
    assertEquals(calls[0].url, `${BASE_URL}/login/totp`)
    assertEquals(calls[0].headers.get('Authorization'), 'Bearer access-token-value')
    assertEquals(result.response, 'TOTP disabled')
  })
})

Deno.test('TotpClient.disable: no session surfaces a 401 RestClientError', async () => {
  await withMockFetch([{ status: 401 }], async () => {
    const client = new TotpClient({ baseUrl: BASE_URL })
    const error = await assertRejects(() => client.disable(''), RestClientError)
    assertEquals(error.realHttpStatus, 401)
  })
})

Deno.test('TotpClient.confirmEnrollment: the answer carries the backup codes, shown once', async () => {
  const backupCodes = ['ABCDE-FGHJK', 'LMNPQ-RSTUV']
  await withMockFetch(
    [{ status: 200, body: { response: 'TOTP enabled', backupCodes } }],
    async () => {
      const client = new TotpClient({ baseUrl: BASE_URL })
      const result = await client.confirmEnrollment('access-token-value', 'SECRET', '654321')
      assertEquals(result.backupCodes, backupCodes)
    },
  )
})

Deno.test('TotpClient.verifyLogin: a backup code travels as the code', async () => {
  await withMockFetch(
    [{ status: 200, body: { accessToken: 'a', refreshToken: 'r', expiresAt: 1 } }],
    async (calls) => {
      const client = new TotpClient({ baseUrl: BASE_URL })
      await client.verifyLogin('user@example.com', 'ABCDE-FGHJK')
      assertEquals(bodyJson(calls[0]), { email: 'user@example.com', code: 'ABCDE-FGHJK' })
    },
  )
})

Deno.test('TotpClient.regenerateBackupCodes: posts login/totp/backup-codes with the bearer and the step-up token', async () => {
  const backupCodes = ['ABCDE-FGHJK']
  await withMockFetch([{ status: 200, body: { backupCodes } }], async (calls) => {
    const client = new TotpClient({ baseUrl: BASE_URL })
    const result = await client.regenerateBackupCodes('access-token-value', 'step-up-token')
    assertEquals([calls[0].method, calls[0].url], ['POST', `${BASE_URL}/login/totp/backup-codes`])
    assertEquals(calls[0].headers.get('Authorization'), 'Bearer access-token-value')
    assertEquals(calls[0].headers.get('X-Znx-Step-Up-Token'), 'step-up-token')
    assertEquals(result.backupCodes, backupCodes)
  })
})

Deno.test('TotpClient.regenerateBackupCodes: without a step-up token only the bearer header is sent', async () => {
  await withMockFetch([{ status: 403 }], async (calls) => {
    const client = new TotpClient({ baseUrl: BASE_URL })
    const error = await assertRejects(
      () => client.regenerateBackupCodes('access-token-value'),
      RestClientError,
    )
    assertEquals(error.realHttpStatus, 403)
    assertEquals(calls[0].headers.get('X-Znx-Step-Up-Token'), null)
  })
})
