import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { mockHandlerContext, mockPageContext } from '@zanix/space/testing'
import { HttpError } from '@zanix/errors'

import LoginTotpPage from 'space/routes/[lang]/login/totp/[email]/page.tsx'
import { fn, mockAccessor } from '../../helpers/mock.ts'
import { mockActionContext, renderComponentWithIntl } from '../../helpers/space-context.ts'

type TotpParams = { lang: string; email: string }

/** Mirrors `en/index.json`'s own real keys `TotpLoginView` formats. */
const TEST_MESSAGES = {
  'login/totp/heading': 'Enter your authenticator code',
  'login/totp/signing-in-as': 'Signing in as {email}.',
  'login/totp/invalid-code': 'Invalid authenticator code.',
  'login/totp/code-label': 'Authenticator code',
  'common/verify': 'Verify',
  'common/back-to-sign-in': 'Back to sign in',
}

function pageWithInteractor(loginWithTOTPCallback: (...args: unknown[]) => unknown) {
  const page = new LoginTotpPage(mockHandlerContext())
  mockAccessor(page, 'interactor', { loginWithTOTPCallback: fn(loginWithTOTPCallback) })
  return page
}

const BASE_VIEW_PROPS = { rateLimited: false, unexpectedError: false } as const

function renderTotpView(props: Parameters<InstanceType<typeof LoginTotpPage>['component']>[0]) {
  const page = new LoginTotpPage(mockHandlerContext())
  return renderComponentWithIntl(page.component, props, TEST_MESSAGES)
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

Deno.test('LoginTotpPage.component: renders the flattened code field errors when present', () => {
  const html = renderTotpView({
    ...BASE_VIEW_PROPS,
    lang: 'en',
    email: 'jane@example.com',
    invalidCode: false,
    fieldErrors: { code: [{ constraints: ['Code must be 6 digits.'] }] },
  })
  assertStringIncludes(html, 'Code must be 6 digits.')
})

Deno.test('LoginTotpPage.component: renders no field error when fieldErrors is unset', () => {
  const html = renderTotpView({
    ...BASE_VIEW_PROPS,
    lang: 'en',
    email: 'jane@example.com',
    invalidCode: false,
  })
  assertEquals(html.includes('Code must be 6 digits.'), false)
})

Deno.test('LoginTotpPage.component: renders every message-catalog string for real, through IntlProvider', () => {
  const html = renderTotpView({
    ...BASE_VIEW_PROPS,
    lang: 'en',
    email: 'jane@example.com',
    invalidCode: true,
  })
  assertStringIncludes(html, 'Enter your authenticator code')
  assertStringIncludes(html, 'Signing in as jane@example.com.')
  assertStringIncludes(html, 'Invalid authenticator code.')
  assertStringIncludes(html, 'Verify</button>')
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

Deno.test('LoginTotpPage.action: honors a redirect_to threaded in from the login page, once the code verifies', async () => {
  const page = pageWithInteractor(() => ({ accessToken: 'a', refreshToken: 'r' }))
  const ctx = mockActionContext<TotpParams, { email: string; code: string }>({
    params: { lang: 'en', email: 'jane@example.com' },
    request: new Request(
      'http://localhost/en/login/totp/jane%40example.com?redirect_to=%2Faccount%2Fsettings',
    ),
    body: { email: 'jane@example.com', code: '123456' },
  })
  const response = await page.action?.(ctx as never)
  assertEquals(response?.headers.get('location'), '/account/settings')
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
