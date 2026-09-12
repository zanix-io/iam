import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { mockHandlerContext, mockPageContext } from '@zanix/space/testing'
import { HttpError } from '@zanix/errors'

import PasswordRecoveryCallbackPage from 'space/routes/[lang]/password/recovery/callback/page.tsx'
import { fn, mockAccessor } from '../../helpers/mock.ts'
import { mockActionContext, renderComponentWithIntl } from '../../helpers/space-context.ts'

type CallbackParams = { lang: string }

/** Mirrors `en/index.json`'s own real keys `RecoveryCallbackView` formats. */
const TEST_MESSAGES = {
  'password/recovery/callback-heading': 'Reset your password',
  'common/invalid-or-expired-code': 'Invalid or expired code.',
  'login/email-label': 'Email',
  'password/recovery/code-label': 'Recovery code',
  'password/recovery/password-label': 'New password',
  'password/recovery/submit': 'Reset password',
}

function pageWithInteractor(recoveryCallback: (...args: unknown[]) => unknown) {
  const page = new PasswordRecoveryCallbackPage(mockHandlerContext())
  mockAccessor(page, 'interactor', { recoveryCallback: fn(recoveryCallback) })
  return page
}

function renderRecoveryCallbackView(
  props: Parameters<InstanceType<typeof PasswordRecoveryCallbackPage>['component']>[0],
) {
  const page = new PasswordRecoveryCallbackPage(mockHandlerContext())
  return renderComponentWithIntl(page.component, props, TEST_MESSAGES)
}

Deno.test('PasswordRecoveryCallbackPage.loader: pre-fills the email from the query string', () => {
  const page = new PasswordRecoveryCallbackPage(mockHandlerContext())
  const request = new Request(
    'http://localhost/en/password/recovery/callback?email=jane%40example.com',
  )
  const ctx = mockPageContext<CallbackParams>({ params: { lang: 'en' }, request })
  const data = page.loader?.(ctx) as { email: string }
  assertEquals(data.email, 'jane@example.com')
})

Deno.test('PasswordRecoveryCallbackPage.component: renders each field’s own flattened errors when present', () => {
  const html = renderRecoveryCallbackView({
    email: 'jane@example.com',
    invalidCode: false,
    fieldErrors: {
      email: [{ constraints: ['Must be a valid email.'] }],
      code: [{ constraints: ['Code must be 6 digits.'] }],
    },
  })
  assertStringIncludes(html, 'Must be a valid email.')
  assertStringIncludes(html, 'Code must be 6 digits.')
})

Deno.test('PasswordRecoveryCallbackPage.component: renders no field errors when fieldErrors is unset', () => {
  const html = renderRecoveryCallbackView({ email: 'jane@example.com', invalidCode: false })
  assertEquals(html.includes('Must be a valid email.'), false)
  assertEquals(html.includes('Code must be 6 digits.'), false)
})

Deno.test('PasswordRecoveryCallbackPage.component: renders every message-catalog string for real, through IntlProvider', () => {
  const html = renderRecoveryCallbackView({ email: 'jane@example.com', invalidCode: true })
  assertStringIncludes(html, 'Reset your password')
  assertStringIncludes(html, 'Invalid or expired code.')
  assertStringIncludes(html, 'Reset password</button>')
})

Deno.test('PasswordRecoveryCallbackPage.action: redirects home once the password resets', async () => {
  const page = pageWithInteractor(() => ({ accessToken: 'a', refreshToken: 'r' }))
  const ctx = mockActionContext<CallbackParams, { email: string; code: string; password: string }>({
    params: { lang: 'en' },
    body: { email: 'jane@example.com', code: '123456', password: 'N3wPassw0rd' },
  })
  const response = await page.action?.(ctx as never)
  assertEquals(response?.headers.get('location'), '/')
})

Deno.test('PasswordRecoveryCallbackPage.action: PRGs back with an error flag on a rejected code', async () => {
  const page = pageWithInteractor(() => {
    throw new HttpError('FORBIDDEN', { message: 'Invalid email or code.' })
  })
  const ctx = mockActionContext<CallbackParams, { email: string; code: string; password: string }>({
    params: { lang: 'en' },
    body: { email: 'jane@example.com', code: 'bad', password: 'N3wPassw0rd' },
  })
  const response = await page.action?.(ctx as never)
  assertEquals(
    response?.headers.get('location'),
    '/en/password/recovery/callback?error=invalid_code',
  )
})

Deno.test('PasswordRecoveryCallbackPage.action: a real server-side fault propagates unchanged', async () => {
  const page = pageWithInteractor(() => {
    throw new HttpError('INTERNAL_SERVER_ERROR', { message: 'Notifier is unreachable.' })
  })
  const ctx = mockActionContext<CallbackParams, { email: string; code: string; password: string }>({
    params: { lang: 'en' },
    body: { email: 'jane@example.com', code: '123456', password: 'N3wPassw0rd' },
  })
  await assertRejects(() => page.action?.(ctx as never) as Promise<Response>)
})
