import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { mockHandlerContext, mockPageContext } from '@zanix/space/testing'
import { HttpError } from '@zanix/errors'

import LoginTotpPage from 'space/routes/[lang]/login/totp/[email]/page.tsx'
import { fn, mockAccessor } from '../../helpers/mock.ts'
import { mockActionContext } from '../../helpers/space-context.ts'

type TotpParams = { lang: string; email: string }

function pageWithInteractor(loginWithTOTPCallback: (...args: unknown[]) => unknown) {
  const page = new LoginTotpPage(mockHandlerContext())
  mockAccessor(page, 'interactor', { loginWithTOTPCallback: fn(loginWithTOTPCallback) })
  return page
}

Deno.test('LoginTotpPage.loader: decodes the email param and surfaces the error flag', () => {
  const page = new LoginTotpPage(mockHandlerContext())
  const ctx = mockPageContext<TotpParams>({
    params: { lang: 'en', email: 'jane%40example.com' },
    request: new Request('http://localhost/en/login/totp/jane%40example.com?error=invalid_code'),
  })
  const data = page.loader?.(ctx) as { email: string; invalidCode: boolean }
  assertEquals(data.email, 'jane@example.com')
  assertEquals(data.invalidCode, true)
})

Deno.test('LoginTotpPage.loader: a malformed percent-sequence email param falls back to the raw value', () => {
  const page = new LoginTotpPage(mockHandlerContext())
  const ctx = mockPageContext<TotpParams>({
    params: { lang: 'en', email: '%E0%A4%A' },
    request: new Request('http://localhost/en/login/totp/%25E0%25A4%25A'),
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

Deno.test('LoginTotpPage.component: renders the flattened code field errors when present', () => {
  const page = new LoginTotpPage(mockHandlerContext())
  const element = page.component({
    lang: 'en',
    email: 'jane@example.com',
    invalidCode: false,
    fieldErrors: { code: [{ constraints: ['Code must be 6 digits.'] }] },
  })
  assertEquals(codeFieldOf(element).props.error, ['Code must be 6 digits.'])
})

Deno.test('LoginTotpPage.component: renders no field error when fieldErrors is unset', () => {
  const page = new LoginTotpPage(mockHandlerContext())
  const element = page.component({
    lang: 'en',
    email: 'jane@example.com',
    invalidCode: false,
  })
  assertEquals(codeFieldOf(element).props.error, undefined)
})

Deno.test('LoginTotpPage.action: redirects home once the code verifies', async () => {
  const page = pageWithInteractor(() => ({ accessToken: 'a', refreshToken: 'r' }))
  const ctx = mockActionContext<TotpParams, { email: string; code: string }>({
    params: { lang: 'en', email: 'jane@example.com' },
    body: { email: 'jane@example.com', code: '123456' },
  })
  const response = await page.action?.(ctx as never)
  assertEquals(response?.headers.get('location'), '/')
})

Deno.test('LoginTotpPage.action: PRGs back with an error flag on a rejected code', async () => {
  const page = pageWithInteractor(() => {
    throw new HttpError('FORBIDDEN', { message: 'Invalid TOTP code.' })
  })
  const ctx = mockActionContext<TotpParams, { email: string; code: string }>({
    params: { lang: 'en', email: 'jane@example.com' },
    body: { email: 'jane@example.com', code: 'bad' },
  })
  const response = await page.action?.(ctx as never)
  assertEquals(
    response?.headers.get('location'),
    '/en/login/totp/jane%40example.com?error=invalid_code',
  )
})

Deno.test('LoginTotpPage.action: a real server-side fault propagates unchanged', async () => {
  const page = pageWithInteractor(() => {
    throw new HttpError('INTERNAL_SERVER_ERROR', { message: 'Notifier is unreachable.' })
  })
  const ctx = mockActionContext<TotpParams, { email: string; code: string }>({
    params: { lang: 'en', email: 'jane@example.com' },
    body: { email: 'jane@example.com', code: '123456' },
  })
  await assertRejects(() => page.action?.(ctx as never) as Promise<Response>)
})
