import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { mockHandlerContext, mockPageContext } from '@zanix/space/testing'
import { HttpError } from '@zanix/errors'
import { SESSION_HEADERS } from '@zanix/server'
import { GITHUB_OAUTH2_CLIENT_ID_ENV, GOOGLE_OAUTH2_CLIENT_ID_ENV } from '@zanix/auth'
import {
  POST_LOGIN_REDIRECT_URL_ENV,
  PRIVACY_NOTICE_URL_ENV,
  REDIRECT_TO_PARAM,
  TERMS_AND_CONDITIONS_URL_ENV,
} from 'utils/constants.ts'

import LoginPage from 'space/routes/[lang]/login/page.tsx'
import { fn, mockAccessor } from '../../helpers/mock.ts'
import { mockActionContext, renderComponentWithIntl } from '../../helpers/space-context.ts'

type LoginViewProps = Parameters<InstanceType<typeof LoginPage>['component']>[0]

/** Mirrors the shared catalog's own real keys this page's `LoginView` actually formats, so the
 * rendered markup reads like the real page, not raw message ids — see `renderComponentWithIntl`'s
 * own doc for why `useIntl()` needs a real render pass at all. */
const TEST_MESSAGES = {
  'login/invalid-credentials': 'Invalid email or password.',
  'login/email-label': 'Email',
  'login/password-label': 'Password',
  'login/submit': 'Sign in',
  'login/terms-link': 'Terms and Conditions',
  'login/privacy-link': 'Privacy Notice',
  'login/oauth-continue': 'Continue with {provider}',
}

function renderLoginView(props: LoginViewProps): string {
  const page = new LoginPage(mockHandlerContext())
  return renderComponentWithIntl(page.component, props, TEST_MESSAGES)
}

type LoginParams = { lang: string }

function pageWithInteractor(loginWithPassword: (...args: unknown[]) => unknown) {
  const page = new LoginPage(mockHandlerContext())
  mockAccessor(page, 'interactor', { loginWithPassword: fn(loginWithPassword) })
  return page
}

Deno.test('LoginPage.redirect: bounces an already-signed-in request away', () => {
  const request = new Request('http://localhost/en/login', {
    headers: { cookie: `${SESSION_HEADERS.user.token as string}=abc.def.ghi` },
  })
  assertEquals(LoginPage.redirect?.condition?.(mockPageContext({ request })), true)
})

Deno.test('LoginPage.redirect: does not fire for an anonymous request', () => {
  const request = new Request('http://localhost/en/login')
  assertEquals(LoginPage.redirect?.condition?.(mockPageContext({ request })), false)
})

Deno.test('LoginPage.loader: only lists an actually-configured OAuth2 provider', () => {
  const originalGoogle = Deno.env.get(GOOGLE_OAUTH2_CLIENT_ID_ENV)
  const originalGithub = Deno.env.get(GITHUB_OAUTH2_CLIENT_ID_ENV)
  Deno.env.set(GOOGLE_OAUTH2_CLIENT_ID_ENV, 'client-id')
  Deno.env.delete(GITHUB_OAUTH2_CLIENT_ID_ENV)
  try {
    const page = new LoginPage(mockHandlerContext())
    const ctx = mockPageContext<LoginParams>({ params: { lang: 'en' } })
    const data = page.loader?.(ctx) as { oauthProviders: readonly string[] }
    assertEquals(data.oauthProviders, ['google'])
  } finally {
    if (originalGoogle === undefined) Deno.env.delete(GOOGLE_OAUTH2_CLIENT_ID_ENV)
    else Deno.env.set(GOOGLE_OAUTH2_CLIENT_ID_ENV, originalGoogle)
    if (originalGithub !== undefined) Deno.env.set(GITHUB_OAUTH2_CLIENT_ID_ENV, originalGithub)
  }
})

Deno.test('LoginPage.loader: exposes termsUrl once TERMS_AND_CONDITIONS_URL is configured', () => {
  const original = Deno.env.get(TERMS_AND_CONDITIONS_URL_ENV)
  Deno.env.set(TERMS_AND_CONDITIONS_URL_ENV, 'https://example.com/terms')
  try {
    const page = new LoginPage(mockHandlerContext())
    const ctx = mockPageContext<LoginParams>({ params: { lang: 'en' } })
    const data = page.loader?.(ctx) as { termsUrl?: string }
    assertEquals(data.termsUrl, 'https://example.com/terms')
  } finally {
    if (original === undefined) Deno.env.delete(TERMS_AND_CONDITIONS_URL_ENV)
    else Deno.env.set(TERMS_AND_CONDITIONS_URL_ENV, original)
  }
})

Deno.test('LoginPage.loader: termsUrl is undefined while TERMS_AND_CONDITIONS_URL is unset', () => {
  const original = Deno.env.get(TERMS_AND_CONDITIONS_URL_ENV)
  Deno.env.delete(TERMS_AND_CONDITIONS_URL_ENV)
  try {
    const page = new LoginPage(mockHandlerContext())
    const ctx = mockPageContext<LoginParams>({ params: { lang: 'en' } })
    const data = page.loader?.(ctx) as { termsUrl?: string }
    assertEquals(data.termsUrl, undefined)
  } finally {
    if (original !== undefined) Deno.env.set(TERMS_AND_CONDITIONS_URL_ENV, original)
  }
})

Deno.test('LoginPage.loader: exposes privacyUrl once PRIVACY_NOTICE_URL is configured', () => {
  const original = Deno.env.get(PRIVACY_NOTICE_URL_ENV)
  Deno.env.set(PRIVACY_NOTICE_URL_ENV, 'https://example.com/privacy')
  try {
    const page = new LoginPage(mockHandlerContext())
    const ctx = mockPageContext<LoginParams>({ params: { lang: 'en' } })
    const data = page.loader?.(ctx) as { privacyUrl?: string }
    assertEquals(data.privacyUrl, 'https://example.com/privacy')
  } finally {
    if (original === undefined) Deno.env.delete(PRIVACY_NOTICE_URL_ENV)
    else Deno.env.set(PRIVACY_NOTICE_URL_ENV, original)
  }
})

Deno.test('LoginPage.loader: privacyUrl is undefined while PRIVACY_NOTICE_URL is unset', () => {
  const original = Deno.env.get(PRIVACY_NOTICE_URL_ENV)
  Deno.env.delete(PRIVACY_NOTICE_URL_ENV)
  try {
    const page = new LoginPage(mockHandlerContext())
    const ctx = mockPageContext<LoginParams>({ params: { lang: 'en' } })
    const data = page.loader?.(ctx) as { privacyUrl?: string }
    assertEquals(data.privacyUrl, undefined)
  } finally {
    if (original !== undefined) Deno.env.set(PRIVACY_NOTICE_URL_ENV, original)
  }
})

/**
 * `resolveBehavior('iam', 'loginHeading')` resolves to `undefined` when called with no
 * `activateApps()` composition ever having registered an override for this app — the exact same
 * standalone-usage shape every other test in this file already exercises `LoginPage` under (no
 * composition, `new LoginPage(mockHandlerContext())` directly). What's under test here is
 * `LoginView`'s own `?? 'Sign in'` fallback, not `@zanix/app`'s override-resolution mechanism
 * itself (already covered by `@zanix/space`'s own `defineSpaceApp` pass-through test, and by
 * `@zanix/app`'s own `resolveBehavior`/`activateApps` suite).
 */
Deno.test('LoginPage.component: renders the default "Sign in" heading with no behavior override registered', () => {
  const html = renderLoginView({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
  })
  assertStringIncludes(html, '<h1>Sign in</h1>')
})

Deno.test('LoginPage.component: renders every message-catalog string for real, through IntlProvider', () => {
  const html = renderLoginView({
    lang: 'en',
    invalidCredentials: true,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: ['google'],
  })
  assertStringIncludes(html, 'Invalid email or password.')
  assertStringIncludes(html, 'Sign in</button>')
  assertStringIncludes(html, 'Continue with Google')
})

Deno.test('LoginPage.component: renders a Terms and Conditions link once termsUrl is set', () => {
  const html = renderLoginView({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
    termsUrl: 'https://example.com/terms',
  })
  assertStringIncludes(html, 'href="https://example.com/terms"')
  assertStringIncludes(html, 'Terms and Conditions')
})

Deno.test('LoginPage.component: renders no Terms and Conditions link when termsUrl is unset', () => {
  const html = renderLoginView({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
  })
  assertEquals(html.includes('Terms and Conditions'), false)
})

Deno.test('LoginPage.component: renders a Privacy Notice link once privacyUrl is set', () => {
  const html = renderLoginView({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
    privacyUrl: 'https://example.com/privacy',
  })
  assertStringIncludes(html, 'href="https://example.com/privacy"')
  assertStringIncludes(html, 'Privacy Notice')
})

Deno.test('LoginPage.component: renders no Privacy Notice link when privacyUrl is unset', () => {
  const html = renderLoginView({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
  })
  assertEquals(html.includes('Privacy Notice'), false)
})

Deno.test('LoginPage.component: renders both links, separated, when termsUrl and privacyUrl are both set', () => {
  const html = renderLoginView({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
    termsUrl: 'https://example.com/terms',
    privacyUrl: 'https://example.com/privacy',
  })
  assertStringIncludes(html, 'href="https://example.com/terms"')
  assertStringIncludes(html, 'href="https://example.com/privacy"')
  assertStringIncludes(html, '·')
})

Deno.test('LoginPage.action: redirects home on real token issuance', async () => {
  const page = pageWithInteractor(() => ({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: 123,
    mustChangePassword: false,
  }))
  const ctx = mockActionContext<LoginParams, { email: string; password: string }>({
    params: { lang: 'en' },
    body: { email: 'jane@example.com', password: 'secret' },
  })
  const response = await page.action?.(ctx as never)
  assertEquals(response?.status, 303)
  assertEquals(response?.headers.get('location'), '/')
})

Deno.test('LoginPage.action: redirects to the configured POST_LOGIN_REDIRECT_URL, not a hardcoded "/"', async () => {
  const original = Deno.env.get(POST_LOGIN_REDIRECT_URL_ENV)
  Deno.env.set(POST_LOGIN_REDIRECT_URL_ENV, '/dashboard')
  try {
    const page = pageWithInteractor(() => ({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 123,
      mustChangePassword: false,
    }))
    const ctx = mockActionContext<LoginParams, { email: string; password: string }>({
      params: { lang: 'en' },
      body: { email: 'jane@example.com', password: 'secret' },
    })
    const response = await page.action?.(ctx as never)
    assertEquals(response?.headers.get('location'), '/dashboard')
  } finally {
    if (original === undefined) Deno.env.delete(POST_LOGIN_REDIRECT_URL_ENV)
    else Deno.env.set(POST_LOGIN_REDIRECT_URL_ENV, original)
  }
})

Deno.test(`LoginPage.action: a request's own ${REDIRECT_TO_PARAM} wins over POST_LOGIN_REDIRECT_URL on real token issuance`, async () => {
  const page = pageWithInteractor(() => ({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: 123,
    mustChangePassword: false,
  }))
  const ctx = mockActionContext<LoginParams, { email: string; password: string }>({
    params: { lang: 'en' },
    request: new Request(`http://localhost/en/login?${REDIRECT_TO_PARAM}=%2Faccount%2Fsettings`),
    body: { email: 'jane@example.com', password: 'secret' },
  })
  const response = await page.action?.(ctx as never)
  assertEquals(response?.headers.get('location'), '/account/settings')
})

Deno.test(`LoginPage.action: threads a request's own ${REDIRECT_TO_PARAM} into the TOTP challenge redirect`, async () => {
  const page = pageWithInteractor(() => ({
    message: 'Two-factor authentication is enabled. Enter your authenticator code.',
    email: 'jane@example.com',
    method: 'totp',
  }))
  const ctx = mockActionContext<LoginParams, { email: string; password: string }>({
    params: { lang: 'en' },
    request: new Request(`http://localhost/en/login?${REDIRECT_TO_PARAM}=%2Faccount%2Fsettings`),
    body: { email: 'jane@example.com', password: 'secret' },
  })
  const response = await page.action?.(ctx as never)
  assertEquals(
    response?.headers.get('location'),
    `/en/login/totp/jane%40example.com?${REDIRECT_TO_PARAM}=%2Faccount%2Fsettings`,
  )
})

Deno.test(`LoginPage.action: an unsafe ${REDIRECT_TO_PARAM} is never threaded into the TOTP challenge redirect`, async () => {
  const page = pageWithInteractor(() => ({
    message: 'Two-factor authentication is enabled. Enter your authenticator code.',
    email: 'jane@example.com',
    method: 'totp',
  }))
  const ctx = mockActionContext<LoginParams, { email: string; password: string }>({
    params: { lang: 'en' },
    request: new Request(
      `http://localhost/en/login?${REDIRECT_TO_PARAM}=${
        encodeURIComponent('https://attacker.example')
      }`,
    ),
    body: { email: 'jane@example.com', password: 'secret' },
  })
  const response = await page.action?.(ctx as never)
  assertEquals(response?.headers.get('location'), '/en/login/totp/jane%40example.com')
})

Deno.test('LoginPage.action: redirects to the TOTP challenge when required', async () => {
  const page = pageWithInteractor(() => ({
    message: 'Two-factor authentication is enabled. Enter your authenticator code.',
    email: 'jane@example.com',
    method: 'totp',
  }))
  const ctx = mockActionContext<LoginParams, { email: string; password: string }>({
    params: { lang: 'en' },
    body: { email: 'jane@example.com', password: 'secret' },
  })
  const response = await page.action?.(ctx as never)
  assertStringIncludes(response?.headers.get('location') ?? '', '/en/login/totp/jane%40example.com')
})

Deno.test('LoginPage.action: redirects to the OTP challenge when required', async () => {
  const page = pageWithInteractor(() => ({
    message: 'Two-factor authentication is enabled. A verification code has been sent.',
    email: 'jane@example.com',
    method: 'email',
  }))
  const ctx = mockActionContext<LoginParams, { email: string; password: string }>({
    params: { lang: 'en' },
    body: { email: 'jane@example.com', password: 'secret' },
  })
  const response = await page.action?.(ctx as never)
  assertStringIncludes(response?.headers.get('location') ?? '', '/en/login/otp/jane%40example.com')
})

Deno.test('LoginPage.action: PRGs back with an error flag on a bad credential', async () => {
  const page = pageWithInteractor(() => {
    throw new HttpError('FORBIDDEN', { message: 'Invalid email or password.' })
  })
  const ctx = mockActionContext<LoginParams, { email: string; password: string }>({
    params: { lang: 'en' },
    body: { email: 'jane@example.com', password: 'wrong' },
  })
  const response = await page.action?.(ctx as never)
  assertEquals(response?.headers.get('location'), '/en/login?error=invalid_credentials')
})

Deno.test('LoginPage.action: a real server-side fault propagates unchanged', () => {
  const page = pageWithInteractor(() => {
    throw new Error('boom')
  })
  const ctx = mockActionContext<LoginParams, { email: string; password: string }>({
    params: { lang: 'en' },
    body: { email: 'jane@example.com', password: 'wrong' },
  })
  return (async () => {
    let threw = false
    try {
      await page.action?.(ctx as never)
    } catch {
      threw = true
    }
    assertEquals(threw, true)
  })()
})
