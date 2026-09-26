import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { mockHandlerContext, mockPageContext } from '@zanix/space/testing'
import { HttpError } from '@zanix/errors'
import { pageSessionGuard } from '@zanix/auth'
import { csrfGuard } from '@zanix/space'

import PhoneConfirmPage from 'space/routes/[lang]/phone/confirm/page.tsx'
import { freeRateLimit, POST_LOGIN_REDIRECT_URL_ENV, REDIRECT_TO_PARAM } from 'utils/constants.ts'
import { fn, mockAccessor } from '../../helpers/mock.ts'
import { mockActionContext } from '../../helpers/space-context.ts'
import {
  allowedBeforeLimit,
  fakeRateLimitCache,
  guardContext,
  guardKind,
  readClassGuards,
} from '../../helpers/route-guards.ts'

type ConfirmParams = { lang: string }

function confirmPage(phoneConfirm: (...args: unknown[]) => unknown) {
  const page = new PhoneConfirmPage(mockHandlerContext())
  const recorder = fn(phoneConfirm)
  mockAccessor(page, 'interactor', { phoneConfirm: recorder })
  return { page, phoneConfirm: recorder }
}

const actionContext = (query = '') =>
  mockActionContext<ConfirmParams>({
    params: { lang: 'en' },
    request: new Request(`http://localhost/en/phone/confirm${query}`, { method: 'POST' }),
    body: { phone: '+14155551234', code: '123456' },
  })

Deno.test('PhoneConfirmPage: requires a signed-in session and a CSRF token', () => {
  const sources = readClassGuards(PhoneConfirmPage).map((guard) => guard.toString())
  assertEquals(sources.includes(pageSessionGuard([]).toString()), true)
  assertEquals(sources.includes(csrfGuard().toString()), true)
})

Deno.test('PhoneConfirmPage.loader: surfaces the phone query param and the invalid-code flag', () => {
  const page = new PhoneConfirmPage(mockHandlerContext())
  const ctx = mockPageContext<ConfirmParams>({
    params: { lang: 'en' },
    request: new Request(
      'http://localhost/en/phone/confirm?phone=%2B14155551234&error=invalid_code',
    ),
  })
  const data = page.loader?.(ctx) as { phone: string; invalidCode: boolean; lang: string }
  assertEquals([data.lang, data.phone, data.invalidCode], ['en', '+14155551234', true])
})

Deno.test('PhoneConfirmPage.loader: a missing phone param resolves to an empty string', () => {
  const page = new PhoneConfirmPage(mockHandlerContext())
  const ctx = mockPageContext<ConfirmParams>({
    params: { lang: 'en' },
    request: new Request('http://localhost/en/phone/confirm'),
  })
  const data = page.loader?.(ctx) as { phone: string; invalidCode: boolean }
  assertEquals([data.phone, data.invalidCode], ['', false])
})

Deno.test('PhoneConfirmPage.action: a verified code redirects to the safe redirect_to target', async () => {
  const { page, phoneConfirm } = confirmPage(() => Promise.resolve({ response: 'ok' }))
  const response = await page.action?.(
    actionContext(`?${REDIRECT_TO_PARAM}=${encodeURIComponent('/account/security')}`),
  ) as Response
  assertEquals(phoneConfirm.calls, [['+14155551234', '123456']])
  assertEquals(response.headers.get('location'), '/account/security')
})

Deno.test('PhoneConfirmPage.action: with no redirect_to, lands on the configured post-login URL', async () => {
  const original = Deno.env.get(POST_LOGIN_REDIRECT_URL_ENV)
  Deno.env.set(POST_LOGIN_REDIRECT_URL_ENV, '/dashboard')
  try {
    const { page } = confirmPage(() => Promise.resolve({ response: 'ok' }))
    const response = await page.action?.(actionContext()) as Response
    assertEquals(response.headers.get('location'), '/dashboard')
  } finally {
    if (original === undefined) Deno.env.delete(POST_LOGIN_REDIRECT_URL_ENV)
    else Deno.env.set(POST_LOGIN_REDIRECT_URL_ENV, original)
  }
})

Deno.test('PhoneConfirmPage.action: a rejected code (FORBIDDEN) sends the visitor back to enroll with the error flag', async () => {
  const { page } = confirmPage(() => {
    throw new HttpError('FORBIDDEN', { message: 'Invalid code.' })
  })
  const response = await page.action?.(actionContext()) as Response
  assertEquals(response.status, 303)
  assertEquals(response.headers.get('location'), '/en/phone/enroll?error=invalid_code')
})

Deno.test('PhoneConfirmPage.action: any other failure propagates', async () => {
  const { page } = confirmPage(() => {
    throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })
  })
  await assertRejects(
    () => page.action?.(actionContext()) as Promise<Response>,
    HttpError,
    'Authentication required.',
  )
})

// The page's action calls `AuthService.phoneConfirm` in-process, so the REST route's own
// `phone:confirm` limit (`login.handler.ts`) never applies to it. Every other code-entry page adds
// its own `rateLimitGuard`; this one must too, capping a signed-in visitor at `freeRateLimit`
// attempts instead of their token-wide rate limit. Fails while the page has no rate limiter.
Deno.test('[regression] PhoneConfirmPage: code attempts are rate-limited to freeRateLimit per signed-in visitor', async () => {
  const limiting = readClassGuards(PhoneConfirmPage).filter((guard) =>
    ['rateLimit', 'phoneIdentity'].includes(guardKind(guard))
  )
  assert(
    limiting.some((guard) => guardKind(guard) === 'rateLimit'),
    'PhoneConfirmPage declares no rateLimitGuard: its code form accepts unlimited attempts',
  )
  const cache = fakeRateLimitCache()
  const allowed = await allowedBeforeLimit(
    limiting,
    () => guardContext(cache, { session: { subject: 'auth-7', rateLimit: 100, type: 'user' } }),
  )
  assertEquals(allowed, freeRateLimit)
})
