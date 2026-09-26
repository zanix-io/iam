import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { mockHandlerContext, mockPageContext } from '@zanix/space/testing'
import { HttpError } from '@zanix/errors'

import LoginOtpPage from 'space/routes/[lang]/login/otp/[email]/page.tsx'
import { fn, mockAccessor } from '../../helpers/mock.ts'
import { mockActionContext, renderComponentWithIntl } from '../../helpers/space-context.ts'

type OtpParams = { lang: string; email: string }

/** Mirrors `en/index.json`'s own real keys `OtpView` formats — see `renderComponentWithIntl`'s own
 * doc for why `useIntl()` needs a real render pass, not a plain `page.component({...})` call. */
const TEST_MESSAGES = {
  'login/otp/heading': 'Enter your verification code',
  'login/otp/sent-to': 'A verification code was sent for {email}.',
  'login/otp/code-label': 'Verification code',
  'login/otp/resend': "Didn't get it? Resend code",
  'login/otp/resend-cooldown': 'We already sent you a code.',
  'login/otp/resend-via-email': 'Send it by email instead',
  'login/otp/resend-via-sms': 'Send it by SMS instead',
  'login/otp/resend-via-whatsapp': 'Send it by WhatsApp instead',
  'common/invalid-or-expired-code': 'Invalid or expired code.',
  'common/verify': 'Verify',
  'common/back-to-sign-in': 'Back to sign in',
}

function pageWithInteractor(loginWithOTPCallback: (...args: unknown[]) => unknown) {
  const page = new LoginOtpPage(mockHandlerContext())
  mockAccessor(page, 'interactor', { loginWithOTPCallback: fn(loginWithOTPCallback) })
  return page
}

function renderOtpView(props: Parameters<InstanceType<typeof LoginOtpPage>['component']>[0]) {
  const page = new LoginOtpPage(mockHandlerContext())
  return renderComponentWithIntl(page.component, props, TEST_MESSAGES)
}

Deno.test('LoginOtpPage.loader: decodes the email param and surfaces the error flag', async () => {
  const page = new LoginOtpPage(mockHandlerContext())
  const ctx = mockPageContext<OtpParams>({
    params: { lang: 'en', email: 'jane%40example.com' },
    request: new Request('http://localhost/en/login/otp/jane%40example.com?error=invalid_code'),
  })
  const data = await page.loader?.(ctx) as { email: string; invalidCode: boolean }
  assertEquals(data.email, 'jane@example.com')
  assertEquals(data.invalidCode, true)
})

Deno.test('LoginOtpPage.loader: no resolveLoginMethods on the interactor degrades to the safe default, never throws', async () => {
  // The real, common shape a test double takes — no `resolveLoginMethods` at all — confirms the
  // loader's own `try`/`catch` actually catches a SYNCHRONOUS throw (calling `undefined` as a
  // function), not just a rejected promise a `.catch()` chain alone would have caught.
  const page = new LoginOtpPage(mockHandlerContext())
  const ctx = mockPageContext<OtpParams>({
    params: { lang: 'en', email: 'jane@example.com' },
    request: new Request('http://localhost/en/login/otp/jane@example.com'),
  })
  const data = await page.loader?.(ctx) as { otpNotifier: unknown; hasVerifiedPhone: unknown }
  assertEquals(data.otpNotifier, null)
  assertEquals(data.hasVerifiedPhone, false)
})

Deno.test('LoginOtpPage.loader: a malformed percent-sequence email param falls back to the raw value', async () => {
  const page = new LoginOtpPage(mockHandlerContext())
  const ctx = mockPageContext<OtpParams>({
    params: { lang: 'en', email: '%E0%A4%A' },
    request: new Request('http://localhost/en/login/otp/%25E0%25A4%25A'),
  })
  const data = await page.loader?.(ctx) as { email: string }
  assertEquals(data.email, '%E0%A4%A')
})

Deno.test('LoginOtpPage.component: renders the flattened code field errors when present', () => {
  const html = renderOtpView({
    lang: 'en',
    email: 'jane@example.com',
    invalidCode: false,
    fieldErrors: { code: [{ constraints: ['Code must be 6 digits.'] }] },
  })
  assertStringIncludes(html, 'Code must be 6 digits.')
})

Deno.test('LoginOtpPage.component: renders no field error when fieldErrors is unset', () => {
  const html = renderOtpView({ lang: 'en', email: 'jane@example.com', invalidCode: false })
  assertEquals(html.includes('Code must be 6 digits.'), false)
})

Deno.test('LoginOtpPage.component: renders every message-catalog string for real, through IntlProvider', () => {
  const html = renderOtpView({ lang: 'en', email: 'jane@example.com', invalidCode: true })
  assertStringIncludes(html, 'Enter your verification code')
  assertStringIncludes(html, 'A verification code was sent for jane@example.com.')
  assertStringIncludes(html, 'Invalid or expired code.')
  assertStringIncludes(html, 'Verify</button>')
  assertStringIncludes(html, 'Back to sign in')
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

Deno.test(
  'LoginOtpPage.action: a reactivation challenge redirects to the reactivate page instead of finishing login',
  async () => {
    const page = pageWithInteractor(() => ({
      needsReactivationConfirm: true,
      reactivationToken: 'r-token',
    }))
    const ctx = mockActionContext<OtpParams, { email: string; code: string }>({
      params: { lang: 'en', email: 'jane@example.com' },
      body: { email: 'jane@example.com', code: '123456' },
    })
    const response = await page.action?.(ctx as never)
    assertEquals(response?.headers.get('location'), '/en/login/reactivate/r-token')
  },
)

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

Deno.test("LoginOtpPage.loader: surfaces the account's own OTP channel and verified-phone flag when the lookup succeeds", async () => {
  const page = new LoginOtpPage(mockHandlerContext())
  mockAccessor(page, 'interactor', {
    resolveLoginMethods: () => Promise.resolve({ otpNotifier: 'sms', hasVerifiedPhone: true }),
  })
  const ctx = mockPageContext<OtpParams>({
    params: { lang: 'en', email: 'jane@example.com' },
    request: new Request('http://localhost/en/login/otp/jane@example.com'),
  })
  const data = await page.loader?.(ctx) as { otpNotifier: unknown; hasVerifiedPhone: unknown }
  assertEquals(data.otpNotifier, 'sms')
  assertEquals(data.hasVerifiedPhone, true)
})
