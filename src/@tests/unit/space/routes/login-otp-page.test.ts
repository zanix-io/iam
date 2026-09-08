import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { mockHandlerContext, mockPageContext } from '@zanix/space/testing'
import { HttpError } from '@zanix/errors'

import LoginOtpPage from 'space/routes/[lang]/login/otp/[email]/page.tsx'
import { fn, mockAccessor } from '../../helpers/mock.ts'
import { mockActionContext } from '../../helpers/space-context.ts'

type OtpParams = { lang: string; email: string }

function pageWithInteractor(loginWithOTPCallback: (...args: unknown[]) => unknown) {
  const page = new LoginOtpPage(mockHandlerContext())
  mockAccessor(page, 'interactor', { loginWithOTPCallback: fn(loginWithOTPCallback) })
  return page
}

Deno.test('LoginOtpPage.loader: decodes the email param and surfaces the error flag', () => {
  const page = new LoginOtpPage(mockHandlerContext())
  const ctx = mockPageContext<OtpParams>({
    params: { lang: 'en', email: 'jane%40example.com' },
    request: new Request('http://localhost/en/login/otp/jane%40example.com?error=invalid_code'),
  })
  const data = page.loader?.(ctx) as { email: string; invalidCode: boolean }
  assertEquals(data.email, 'jane@example.com')
  assertEquals(data.invalidCode, true)
})

Deno.test('LoginOtpPage.loader: a malformed percent-sequence email param falls back to the raw value', () => {
  const page = new LoginOtpPage(mockHandlerContext())
  const ctx = mockPageContext<OtpParams>({
    params: { lang: 'en', email: '%E0%A4%A' },
    request: new Request('http://localhost/en/login/otp/%25E0%25A4%25A'),
  })
  const data = page.loader?.(ctx) as { email: string }
  assertEquals(data.email, '%E0%A4%A')
})

// `<main>` children, in JSX order: h1, p, invalidCode slot, SubmitGuard, form, back-link — the
// `<form>` (index 4) itself carries [hidden csrf, hidden email, Field, Button], Field at index 2.
function codeFieldOf(element: { props: { children: unknown[] } }) {
  const form = (element.props.children as unknown[])[4] as { props: { children: unknown[] } }
  return form.props.children[2] as { props: { error: string[] | undefined } }
}

Deno.test('LoginOtpPage.component: renders the flattened code field errors when present', () => {
  const page = new LoginOtpPage(mockHandlerContext())
  const element = page.component({
    lang: 'en',
    email: 'jane@example.com',
    invalidCode: false,
    fieldErrors: { code: [{ constraints: ['Code must be 6 digits.'] }] },
  })
  assertEquals(codeFieldOf(element).props.error, ['Code must be 6 digits.'])
})

Deno.test('LoginOtpPage.component: renders no field error when fieldErrors is unset', () => {
  const page = new LoginOtpPage(mockHandlerContext())
  const element = page.component({
    lang: 'en',
    email: 'jane@example.com',
    invalidCode: false,
  })
  assertEquals(codeFieldOf(element).props.error, undefined)
})

Deno.test('LoginOtpPage.action: redirects home once the code verifies', async () => {
  const page = pageWithInteractor(() => ({ accessToken: 'a', refreshToken: 'r' }))
  const ctx = mockActionContext<OtpParams, { email: string; code: string }>({
    params: { lang: 'en', email: 'jane@example.com' },
    body: { email: 'jane@example.com', code: '123456' },
  })
  const response = await page.action?.(ctx as never)
  assertEquals(response?.headers.get('location'), '/')
})

Deno.test('LoginOtpPage.action: PRGs back with an error flag on a rejected code', async () => {
  const page = pageWithInteractor(() => {
    throw new HttpError('FORBIDDEN', { message: 'Invalid email or code.' })
  })
  const ctx = mockActionContext<OtpParams, { email: string; code: string }>({
    params: { lang: 'en', email: 'jane@example.com' },
    body: { email: 'jane@example.com', code: 'bad' },
  })
  const response = await page.action?.(ctx as never)
  assertEquals(
    response?.headers.get('location'),
    '/en/login/otp/jane%40example.com?error=invalid_code',
  )
})

Deno.test('LoginOtpPage.action: a real server-side fault propagates unchanged', async () => {
  const page = pageWithInteractor(() => {
    throw new HttpError('INTERNAL_SERVER_ERROR', { message: 'Notifier is unreachable.' })
  })
  const ctx = mockActionContext<OtpParams, { email: string; code: string }>({
    params: { lang: 'en', email: 'jane@example.com' },
    body: { email: 'jane@example.com', code: '123456' },
  })
  await assertRejects(() => page.action?.(ctx as never) as Promise<Response>)
})
