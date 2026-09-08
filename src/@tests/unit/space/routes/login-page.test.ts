import { assertEquals, assertExists, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { mockHandlerContext, mockPageContext } from '@zanix/space/testing'
import { HttpError } from '@zanix/errors'
import { SESSION_HEADERS } from '@zanix/server'
import { GITHUB_OAUTH2_CLIENT_ID_ENV, GOOGLE_OAUTH2_CLIENT_ID_ENV } from '@zanix/auth'
import { TERMS_AND_CONDITIONS_URL_ENV } from 'utils/constants.ts'

import LoginPage from 'space/routes/[lang]/login/page.tsx'
import { fn, mockAccessor } from '../../helpers/mock.ts'
import { mockActionContext } from '../../helpers/space-context.ts'

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

Deno.test('LoginPage.component: renders a Terms and Conditions link once termsUrl is set', () => {
  const page = new LoginPage(mockHandlerContext())
  const element = page.component({
    lang: 'en',
    invalidCredentials: false,
    oauthProviders: [],
    termsUrl: 'https://example.com/terms',
  })
  // `<main>` children, in JSX order: h1, invalidCredentials slot, ManagedForm, form, terms slot,
  // oauth slot — see `LoginView`'s own source. Index 4 is the terms slot under test here.
  const termsSlot = (element.props.children as unknown[])[4] as {
    props: { children: { props: { href: string } } }
  }
  assertExists(termsSlot)
  assertEquals(termsSlot.props.children.props.href, 'https://example.com/terms')
})

Deno.test('LoginPage.component: renders no Terms and Conditions link when termsUrl is unset', () => {
  const page = new LoginPage(mockHandlerContext())
  const element = page.component({
    lang: 'en',
    invalidCredentials: false,
    oauthProviders: [],
  })
  const termsSlot = (element.props.children as unknown[])[4]
  assertEquals(termsSlot, undefined)
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

Deno.test('LoginPage.action: redirects to the TOTP challenge when required', async () => {
  const page = pageWithInteractor(() => ({
    message: 'Two-factor authentication is enabled. Enter your authenticator code.',
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
