import { assertEquals } from 'jsr:@std/assert@0.224'
import { mockHandlerContext, mockPageContext } from '@zanix/space/testing'
import { pageSessionGuard } from '@zanix/auth'
import { csrfGuard } from '@zanix/space'

import PhoneEnrollPage from 'space/routes/[lang]/phone/enroll/page.tsx'
import { fn, mockAccessor } from '../../helpers/mock.ts'
import { mockActionContext } from '../../helpers/space-context.ts'
import { readClassGuards } from '../../helpers/route-guards.ts'

type EnrollParams = { lang: string }

Deno.test('PhoneEnrollPage: requires a signed-in session and a CSRF token', () => {
  const sources = readClassGuards(PhoneEnrollPage).map((guard) => guard.toString())
  assertEquals(sources.includes(pageSessionGuard([]).toString()), true)
  assertEquals(sources.includes(csrfGuard().toString()), true)
})

Deno.test('PhoneEnrollPage.loader: surfaces lang, the CSRF token and the invalid-code flag', () => {
  const page = new PhoneEnrollPage(mockHandlerContext())
  const ctx = mockPageContext<EnrollParams>({
    params: { lang: 'es' },
    request: new Request('http://localhost/es/phone/enroll?error=invalid_code'),
  })
  const data = page.loader?.(ctx) as { lang: string; invalidCode: boolean; csrfToken: unknown }
  assertEquals(data.lang, 'es')
  assertEquals(data.invalidCode, true)
  assertEquals(data.csrfToken, ctx.csrfToken)
})

Deno.test('PhoneEnrollPage.loader: no error param means no invalid-code flag', () => {
  const page = new PhoneEnrollPage(mockHandlerContext())
  const ctx = mockPageContext<EnrollParams>({
    params: { lang: 'en' },
    request: new Request('http://localhost/en/phone/enroll'),
  })
  assertEquals((page.loader?.(ctx) as { invalidCode: boolean }).invalidCode, false)
})

Deno.test('PhoneEnrollPage.action: sends the code, then redirects to the confirm step carrying the encoded phone', async () => {
  const page = new PhoneEnrollPage(mockHandlerContext())
  const phoneEnroll = fn((_phone: string) => Promise.resolve({ response: 'sent' }))
  mockAccessor(page, 'interactor', { phoneEnroll })
  const response = await page.action?.(
    mockActionContext<EnrollParams>({ params: { lang: 'en' }, body: { phone: '+14155551234' } }),
  ) as Response
  assertEquals(phoneEnroll.calls, [['+14155551234']])
  assertEquals(response.status, 303)
  assertEquals(response.headers.get('location'), '/en/phone/confirm?phone=%2B14155551234')
})
