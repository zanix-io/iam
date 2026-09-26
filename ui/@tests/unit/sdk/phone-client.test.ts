import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { RestClientError } from '@zanix/server'

import { PhoneClient } from '../../../sdk/client/phone.client.ts'
import { bodyJson, withMockFetch } from './fetch-mock.ts'

const BASE_URL = 'https://iam.example.com'
const TOKEN = 'access-token-value'

Deno.test('PhoneClient.enroll: posts the phone to login/phone/enroll with a bearer header', async () => {
  await withMockFetch([{ status: 200, body: { response: 'code sent' } }], async (calls) => {
    const result = await new PhoneClient({ baseUrl: BASE_URL }).enroll(TOKEN, '+14155551234')
    assertEquals([calls[0].method, calls[0].url], ['POST', `${BASE_URL}/login/phone/enroll`])
    assertEquals(calls[0].headers.get('Authorization'), `Bearer ${TOKEN}`)
    assertEquals(bodyJson(calls[0]), { phone: '+14155551234' })
    assertEquals(result.response, 'code sent')
  })
})

Deno.test('PhoneClient.confirm: posts the phone and the SMS code to login/phone/confirm', async () => {
  await withMockFetch([{ status: 200, body: { response: 'phone verified' } }], async (calls) => {
    await new PhoneClient({ baseUrl: BASE_URL }).confirm(TOKEN, '+14155551234', '123456')
    assertEquals([calls[0].method, calls[0].url], ['POST', `${BASE_URL}/login/phone/confirm`])
    assertEquals(bodyJson(calls[0]), { phone: '+14155551234', code: '123456' })
  })
})

Deno.test('PhoneClient.confirm: a wrong code surfaces the 403 as a RestClientError', async () => {
  await withMockFetch([{ status: 403 }], async () => {
    const error = await assertRejects(
      () => new PhoneClient({ baseUrl: BASE_URL }).confirm(TOKEN, '+14155551234', '000000'),
      RestClientError,
    )
    assertEquals(error.realHttpStatus, 403)
  })
})

Deno.test('PhoneClient.disable: deletes login/phone with a bearer header', async () => {
  await withMockFetch([{ status: 200, body: { response: 'phone removed' } }], async (calls) => {
    await new PhoneClient({ baseUrl: BASE_URL }).disable(TOKEN)
    assertEquals([calls[0].method, calls[0].url], ['DELETE', `${BASE_URL}/login/phone`])
    assertEquals(calls[0].headers.get('Authorization'), `Bearer ${TOKEN}`)
  })
})

Deno.test('PhoneClient.setOtpNotifier: sends the chosen channel', async () => {
  await withMockFetch([{ status: 200, body: { response: 'updated' } }], async (calls) => {
    await new PhoneClient({ baseUrl: BASE_URL }).setOtpNotifier(TOKEN, 'whatsapp')
    assertEquals([calls[0].method, calls[0].url], ['POST', `${BASE_URL}/login/otp-notifier`])
    assertEquals(bodyJson(calls[0]), { notifier: 'whatsapp' })
  })
})

Deno.test("PhoneClient.setOtpNotifier: omitted or '' sends no notifier (reset to email)", async () => {
  await withMockFetch([{ status: 200, body: { response: 'updated' } }], async (calls) => {
    const client = new PhoneClient({ baseUrl: BASE_URL })
    await client.setOtpNotifier(TOKEN)
    await client.setOtpNotifier(TOKEN, '')
    assertEquals([bodyJson(calls[0]), bodyJson(calls[1])], [{}, {}])
  })
})
