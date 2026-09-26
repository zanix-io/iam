import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { mockHandlerContext, mockPageContext } from '@zanix/space/testing'
import { HttpError } from '@zanix/errors'

import LoginOauthCallbackPage from 'space/routes/[lang]/login/[oauth]/callback/page.tsx'
import { fn, mockAccessor } from '../../helpers/mock.ts'

type CallbackParams = { lang: string; oauth: string }

function pageWithInteractor(loginWithOauthCallback: (...args: unknown[]) => unknown) {
  const page = new LoginOauthCallbackPage(mockHandlerContext())
  mockAccessor(page, 'interactor', { loginWithOauthCallback: fn(loginWithOauthCallback) })
  return page
}

Deno.test('LoginOauthCallbackPage.loader: rejects an unknown provider as not-found', async () => {
  const page = pageWithInteractor(() => ({ accessToken: 'a', refreshToken: 'r' }))
  const ctx = mockPageContext<CallbackParams>({
    params: { lang: 'en', oauth: 'facebook' },
    request: new Request('http://localhost/en/login/facebook/callback?code=abc'),
    url: new URL('http://localhost/en/login/facebook/callback?code=abc'),
  })
  await assertRejects(() => Promise.resolve(page.loader?.(ctx)), HttpError)
})

Deno.test('LoginOauthCallbackPage.loader: rejects a missing authorization code', async () => {
  const page = pageWithInteractor(() => ({ accessToken: 'a', refreshToken: 'r' }))
  const ctx = mockPageContext<CallbackParams>({
    params: { lang: 'en', oauth: 'google' },
    request: new Request('http://localhost/en/login/google/callback'),
    url: new URL('http://localhost/en/login/google/callback'),
  })
  await assertRejects(() => Promise.resolve(page.loader?.(ctx)), HttpError)
})

Deno.test('LoginOauthCallbackPage.loader: exchanges a real code via the interactor', async () => {
  const loginWithOauthCallback = fn((..._args: unknown[]) => ({
    accessToken: 'a',
    refreshToken: 'r',
  }))
  const page = new LoginOauthCallbackPage(mockHandlerContext())
  mockAccessor(page, 'interactor', { loginWithOauthCallback })
  const ctx = mockPageContext<CallbackParams>({
    params: { lang: 'en', oauth: 'google' },
    request: new Request('http://localhost/en/login/google/callback?code=abc123'),
    url: new URL('http://localhost/en/login/google/callback?code=abc123'),
  })
  const data = await page.loader?.(ctx)
  assertEquals(loginWithOauthCallback.calls[0], ['abc123', 'google'])
  // A completed login — no reactivation redirect, the view's own default (`'/'`) applies.
  assertEquals(data, {})
})

Deno.test(
  'LoginOauthCallbackPage.loader: a reactivation challenge returns redirectTo the reactivate page instead of finishing login',
  async () => {
    const page = pageWithInteractor(() => ({
      needsReactivationConfirm: true,
      reactivationToken: 'r-token',
    }))
    const ctx = mockPageContext<CallbackParams>({
      params: { lang: 'en', oauth: 'google' },
      request: new Request('http://localhost/en/login/google/callback?code=abc123'),
      url: new URL('http://localhost/en/login/google/callback?code=abc123'),
    })
    const data = await page.loader?.(ctx)
    assertEquals(data, { redirectTo: '/en/login/reactivate/r-token' })
  },
)

Deno.test('LoginOauthCallbackPage.loader: a TOTP challenge redirects to the authenticator-code step', async () => {
  const page = pageWithInteractor(() => ({
    message: 'Two-factor authentication is enabled. Enter your authenticator code.',
    email: 'jane@example.com',
    method: 'totp',
  }))
  const ctx = mockPageContext<CallbackParams>({
    params: { lang: 'en', oauth: 'google' },
    request: new Request('http://localhost/en/login/google/callback?code=abc123'),
    url: new URL('http://localhost/en/login/google/callback?code=abc123'),
  })
  assertEquals(await page.loader?.(ctx), { redirectTo: '/en/login/totp/jane%40example.com' })
})

Deno.test('LoginOauthCallbackPage.loader: a notifier challenge redirects to the one-time-code step', async () => {
  const page = pageWithInteractor(() => ({
    message: 'Two-factor authentication is enabled. A verification code has been sent.',
    email: 'jane@example.com',
    method: 'sms',
  }))
  const ctx = mockPageContext<CallbackParams>({
    params: { lang: 'en', oauth: 'google' },
    request: new Request('http://localhost/en/login/google/callback?code=abc123'),
    url: new URL('http://localhost/en/login/google/callback?code=abc123'),
  })
  assertEquals(await page.loader?.(ctx), { redirectTo: '/en/login/otp/jane%40example.com' })
})
