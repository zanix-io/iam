import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { RestClientError } from '@zanix/server'

import { StepUpClient } from '../../../sdk/client/step-up.client.ts'
import { StepUpRequestRTO, StepUpVerifyRTO } from '../../../sdk/rtos/step-up.ts'
import { bodyJson, withMockFetch } from './fetch-mock.ts'

const BASE_URL = 'https://iam.example.com'

Deno.test('StepUpClient.request: posts the purpose to step-up/request with a bearer header', async () => {
  await withMockFetch(
    [{ status: 200, body: { method: 'otp', channel: 'sms', expiresInSeconds: 300 } }],
    async (calls) => {
      const client = new StepUpClient({ baseUrl: BASE_URL })
      const result = await client.request('access-token-value', 'wallet-transfer')
      assertEquals(calls[0].method, 'POST')
      assertEquals(calls[0].url, `${BASE_URL}/step-up/request`)
      assertEquals(calls[0].headers.get('Authorization'), 'Bearer access-token-value')
      assertEquals(bodyJson(calls[0]), { purpose: 'wallet-transfer' })
      assertEquals(result, { method: 'otp', channel: 'sms', expiresInSeconds: 300 })
    },
  )
})

Deno.test('StepUpClient.verify: posts purpose, code and bind to step-up/verify with a bearer header', async () => {
  await withMockFetch(
    [{ status: 200, body: { stepUpToken: 'jwt', expiresAt: 1790000000 } }],
    async (calls) => {
      const client = new StepUpClient({ baseUrl: BASE_URL })
      const result = await client.verify('access-token-value', 'wallet-transfer', '123456', 'tx-42')
      assertEquals(calls[0].url, `${BASE_URL}/step-up/verify`)
      assertEquals(calls[0].headers.get('Authorization'), 'Bearer access-token-value')
      assertEquals(bodyJson(calls[0]), {
        purpose: 'wallet-transfer',
        code: '123456',
        bind: 'tx-42',
      })
      assertEquals(result, { stepUpToken: 'jwt', expiresAt: 1790000000 })
    },
  )
})

Deno.test('StepUpClient.verify: without a bind the body carries none', async () => {
  await withMockFetch(
    [{ status: 200, body: { stepUpToken: 'jwt', expiresAt: 1 } }],
    async (calls) => {
      await new StepUpClient({ baseUrl: BASE_URL }).verify('t', 'wallet-transfer', '123456')
      assertEquals(bodyJson(calls[0]), { purpose: 'wallet-transfer', code: '123456' })
    },
  )
})

Deno.test('StepUpClient: a refusal surfaces as a RestClientError with the real status', async () => {
  for (const status of [401, 403, 429]) {
    // deno-lint-ignore no-await-in-loop
    await withMockFetch([{ status }], async () => {
      const client = new StepUpClient({ baseUrl: BASE_URL })
      const asked = await assertRejects(
        () => client.request('t', 'wallet-transfer'),
        RestClientError,
      )
      assertEquals(asked.realHttpStatus, status)
      const verified = await assertRejects(
        () => client.verify('t', 'wallet-transfer', '1'),
        RestClientError,
      )
      assertEquals(verified.realHttpStatus, status)
    })
  }
})

Deno.test('step-up RTOs: the SDK request classes carry the same field names the server reads', () => {
  const request = new StepUpRequestRTO()
  request.purpose = 'wallet-transfer'
  assertEquals(JSON.parse(JSON.stringify(request)), { purpose: 'wallet-transfer' })
  const verify = new StepUpVerifyRTO()
  verify.purpose = 'wallet-transfer'
  verify.code = '1'
  assertEquals(JSON.parse(JSON.stringify(verify)), { purpose: 'wallet-transfer', code: '1' })
})

Deno.test('factor changes: every client method sends the step-up token in X-Znx-Step-Up-Token, and omits the header without one', async () => {
  const { TotpClient } = await import('../../../sdk/client/totp.client.ts')
  const { PhoneClient } = await import('../../../sdk/client/phone.client.ts')
  const { PasswordClient } = await import('../../../sdk/client/password.client.ts')
  const totp = new TotpClient({ baseUrl: BASE_URL })
  const phone = new PhoneClient({ baseUrl: BASE_URL })
  const password = new PasswordClient({ baseUrl: BASE_URL })

  const changes: [string, (proof?: string) => Promise<unknown>][] = [
    ['login/totp/confirm', (p) => totp.confirmEnrollment('a', 'S', '123456', p)],
    ['login/totp', (p) => totp.disable('a', p)],
    ['login/phone/confirm', (p) => phone.confirm('a', '+15551234567', '123456', p)],
    ['login/phone', (p) => phone.disable('a', p)],
    ['login/otp-notifier', (p) => phone.setOtpNotifier('a', 'sms', p)],
    ['pwd/change', (p) => password.change('a', 'old', 'new', p)],
    ['pwd/add', (p) => password.addPassword('a', 'new', p)],
    ['pwd/remove', (p) => password.removePassword('a', p)],
  ]
  for (const [path, change] of changes) {
    // deno-lint-ignore no-await-in-loop
    await withMockFetch([{ status: 200, body: { response: 'ok' } }], async (calls) => {
      await change('proof-token')
      assertEquals(calls[0].url, `${BASE_URL}/${path}`, path)
      assertEquals(calls[0].headers.get('Authorization'), 'Bearer a', path)
      assertEquals(calls[0].headers.get('X-Znx-Step-Up-Token'), 'proof-token', path)
    })
    // deno-lint-ignore no-await-in-loop
    await withMockFetch([{ status: 200, body: { response: 'ok' } }], async (calls) => {
      await change()
      assertEquals(calls[0].headers.get('X-Znx-Step-Up-Token'), null, path)
    })
  }
})
