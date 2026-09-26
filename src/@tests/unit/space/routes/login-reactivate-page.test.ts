import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { mockHandlerContext, mockPageContext } from '@zanix/space/testing'
import { HttpError } from '@zanix/errors'

import LoginReactivatePage from 'space/routes/[lang]/login/reactivate/[token]/page.tsx'
import { fn, mockAccessor } from '../../helpers/mock.ts'
import { mockActionContext, renderComponentWithIntl } from '../../helpers/space-context.ts'

type ReactivateParams = { lang: string; token: string }

/** Mirrors `en/index.json`'s own real keys `ReactivateConfirmView` formats — see
 * `renderComponentWithIntl`'s own doc for why `useIntl()` needs a real render pass, not a plain
 * `page.component({...})` call. */
const TEST_MESSAGES = {
  'login/reactivate/heading': 'Your account is deactivated',
  'login/reactivate/body':
    "If you continue, your account will be reactivated automatically and you'll be able to use it normally again.",
  'login/reactivate/confirm': 'Yes, reactivate my account',
  'login/reactivate/cancel': 'Cancel',
  'login/reactivate/expired':
    'This reactivation link is no longer valid or has expired. Sign in again to get a new one.',
  'common/back-to-sign-in': 'Back to sign in',
}

function pageWithInteractor(confirmReactivation: (...args: unknown[]) => unknown) {
  const page = new LoginReactivatePage(mockHandlerContext())
  mockAccessor(page, 'interactor', { confirmReactivation: fn(confirmReactivation) })
  return page
}

function renderReactivateView(
  props: Parameters<InstanceType<typeof LoginReactivatePage>['component']>[0],
) {
  const page = new LoginReactivatePage(mockHandlerContext())
  return renderComponentWithIntl(page.component, props, TEST_MESSAGES)
}

Deno.test('LoginReactivatePage.loader: surfaces the lang/csrfToken/expired flag', () => {
  const page = new LoginReactivatePage(mockHandlerContext())
  const ctx = mockPageContext<ReactivateParams>({
    params: { lang: 'en', token: 'r-token' },
    request: new Request('http://localhost/en/login/reactivate/r-token?error=expired'),
  })
  const data = page.loader?.(ctx) as { lang: string; expired: boolean }
  assertEquals(data.lang, 'en')
  assertEquals(data.expired, true)
})

Deno.test('LoginReactivatePage.component: renders the confirm form when not expired', () => {
  const html = renderReactivateView({ lang: 'en', expired: false })
  assertStringIncludes(html, 'Your account is deactivated')
  assertStringIncludes(html, 'will be reactivated automatically')
  assertStringIncludes(html, 'Yes, reactivate my account</button>')
  assertEquals(html.includes('Back to sign in'), false)
})

Deno.test('LoginReactivatePage.component: renders the expired banner instead of the form', () => {
  const html = renderReactivateView({ lang: 'en', expired: true })
  assertStringIncludes(html, 'no longer valid or has expired')
  assertStringIncludes(html, 'Back to sign in')
  assertEquals(html.includes('Yes, reactivate my account'), false)
})

Deno.test('LoginReactivatePage.action: confirming reactivation redirects to the default post-login destination', async () => {
  const page = pageWithInteractor(() => ({ accessToken: 'a', refreshToken: 'r' }))
  const ctx = mockActionContext<ReactivateParams, Record<string, never>>({
    params: { lang: 'en', token: 'r-token' },
    body: {},
  })
  const response = await page.action?.(ctx as never)
  assertEquals(response?.headers.get('location'), '/')
})

Deno.test('LoginReactivatePage.action: an invalid/expired token PRGs back with error=expired', async () => {
  const page = pageWithInteractor(() => {
    throw new HttpError('FORBIDDEN', {
      message: 'This reactivation link is invalid or has expired.',
    })
  })
  const ctx = mockActionContext<ReactivateParams, Record<string, never>>({
    params: { lang: 'en', token: 'bad-token' },
    body: {},
  })
  const response = await page.action?.(ctx as never)
  assertEquals(
    response?.headers.get('location'),
    '/en/login/reactivate/bad-token?error=expired',
  )
})

Deno.test('LoginReactivatePage.action: a real server-side fault propagates unchanged', async () => {
  const page = pageWithInteractor(() => {
    throw new HttpError('INTERNAL_SERVER_ERROR', { message: 'Database is unreachable.' })
  })
  const ctx = mockActionContext<ReactivateParams, Record<string, never>>({
    params: { lang: 'en', token: 'r-token' },
    body: {},
  })
  await assertRejects(() => page.action?.(ctx as never) as Promise<Response>)
})
