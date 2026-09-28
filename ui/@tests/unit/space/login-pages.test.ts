import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { RestClientError } from '@zanix/server'
import type { HttpError } from '@zanix/errors'
import type { PageActionContext, PageContext } from '@zanix/space'
import {
  buildOauthStateSetCookieHeader,
  handleLoginEntryAction,
  handleLoginMethodsAction,
  handleLogoutAction,
  handleOauthStartAction,
  handleOtpResendAction,
  handleOtpVerifyAction,
  handlePasswordLoginAction,
  handleReactivateAction,
  handleRecoveryRequestAction,
  handleTotpLoginAction,
  loginEntryPageData,
  markSessionRevoked,
  oauthStartPageData,
  otpVerifyPageData,
  reactivatePageData,
  totpLoginPageData,
} from '../../../space/login-pages.ts'

const upstream = (status: number, retryAfterSeconds?: number) => {
  const error = new RestClientError('BAD_GATEWAY', {
    message: 'upstream',
    meta: { upstreamStatus: status },
  })
  if (retryAfterSeconds !== undefined) {
    Object.defineProperty(error, 'retryAfterSeconds', { value: retryAfterSeconds })
  }
  return error
}

/** The slice of a page context these functions read. */
const ctx = <T extends Record<string, string>>(params: T, path = '/', extra = {}) =>
  ({
    params,
    url: new URL(`https://app.test${path}`),
    csrfToken: 'csrf',
    cspNonce: 'nonce',
    ...extra,
  }) as unknown as
    & PageContext<T>
    & PageActionContext<T>

const location = (response: Response) => response.headers.get('location') ?? ''

Deno.test('totpLoginPageData: what TotpLoginView takes, read off the request', () => {
  const data = totpLoginPageData(
    ctx(
      { lang: 'es', email: 'jane%2Bx%40example.com' },
      '/?error=rate_limited&retryUntil=1700000000000',
    ),
  )
  assertEquals(data.email, 'jane+x@example.com')
  assertEquals(data.rateLimited, true)
  assertEquals(data.invalidCode, false)
  assertEquals(data.unexpectedError, false)
  assertEquals(data.retryUntil, 1700000000000)
  assertEquals(data.clearQueryParamsOnRateLimitComplete, ['error', 'retryUntil'])
  assertEquals([data.csrfToken, data.nonce], ['csrf', 'nonce'])
  assertEquals(
    totpLoginPageData(ctx({ lang: 'es', email: 'a' }, '/?error=invalid_code')).invalidCode,
    true,
  )
})

Deno.test('handleTotpLoginAction: every upstream rejection returns to the same screen, keeping redirect_to', async () => {
  const cases: [Error, string][] = [
    [upstream(403), 'error=invalid_code'],
    [upstream(429), 'error=rate_limited'],
    [upstream(500), 'error=unexpected_error'],
  ]
  await Promise.all(cases.map(async ([error, expected]) => {
    const response = await handleTotpLoginAction(
      ctx({ lang: 'es', email: 'a%40x.test' }, '/?redirect_to=/es/orders'),
      {
        totpClient: { verifyLogin: () => Promise.reject(error) } as never,
        code: '123456',
        defaultPath: '/es/home',
      },
    )
    assertEquals(
      location(response),
      `/es/login/totp/a%40x.test?${expected}&redirect_to=%2Fes%2Forders`,
    )
  }))
})

Deno.test("handleTotpLoginAction: a failure that is not the upstream's propagates", async () => {
  await assertRejects(() =>
    handleTotpLoginAction(ctx({ lang: 'es', email: 'a' }), {
      totpClient: { verifyLogin: () => Promise.reject(new TypeError('bug')) } as never,
      code: '1',
      defaultPath: '/',
    }), TypeError)
})

Deno.test('oauthStartPageData: a provider iam offers, or NOT_FOUND', () => {
  assertEquals(oauthStartPageData(ctx({ lang: 'es', oauth: 'google' })), {
    lang: 'es',
    oauth: 'google',
    csrfToken: 'csrf',
  })
  try {
    oauthStartPageData(ctx({ lang: 'es', oauth: 'myspace' }))
    throw new Error('expected a throw')
  } catch (error) {
    assertEquals((error as HttpError).status.code, 'NOT_FOUND')
  }
})

Deno.test('handleOauthStartAction: redirects to the provider and persists the state iam minted', async () => {
  const response = await handleOauthStartAction(ctx({ lang: 'es', oauth: 'google' }), {
    loginClient: {
      oauthAuthorize: (provider: string) =>
        Promise.resolve({ url: `https://provider.test/auth?p=${provider}`, state: 'abc123' }),
    } as never,
  })
  assertEquals(response.status, 302)
  assertEquals(location(response), 'https://provider.test/auth?p=google')
  const cookie = response.headers.get('set-cookie') ?? ''
  assertEquals(cookie, buildOauthStateSetCookieHeader('abc123'))
  for (const attribute of ['abc123', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) {
    assertEquals(cookie.includes(attribute), true, attribute)
  }
})

Deno.test('reactivatePageData: the expired flag comes off the request', () => {
  assertEquals(reactivatePageData(ctx({ lang: 'es', token: 't' }, '/?error=expired')).expired, true)
  assertEquals(reactivatePageData(ctx({ lang: 'es', token: 't' })).expired, false)
})

Deno.test('handleReactivateAction: an expired token returns to the page; a challenge falls back to sign-in', async () => {
  const expired = await handleReactivateAction(ctx({ lang: 'es', token: 'tok' }), {
    loginClient: { confirmReactivation: () => Promise.reject(upstream(403)) } as never,
    defaultPath: '/es/home',
  })
  assertEquals(location(expired), '/es/login/reactivate/tok?error=expired')

  const challenge = await handleReactivateAction(ctx({ lang: 'es', token: 'tok' }), {
    loginClient: { confirmReactivation: () => Promise.resolve({ challenge: 'totp' }) } as never,
    defaultPath: '/es/home',
  })
  assertEquals(location(challenge), '/es/login')

  await assertRejects(() =>
    handleReactivateAction(ctx({ lang: 'es', token: 'tok' }), {
      loginClient: { confirmReactivation: () => Promise.reject(upstream(500)) } as never,
      defaultPath: '/es/home',
    }), RestClientError)
})

Deno.test('handleOtpResendAction: no dispatch mid-cooldown, a failed dispatch changes nothing, success carries the channel', async () => {
  const dispatched: unknown[] = []
  const stamped: string[] = []
  const otpClient = {
    request: (email: string, notifier: unknown) => {
      dispatched.push([email, notifier])
      return Promise.resolve()
    },
  } as never
  const idle = {
    endsAt: () => Promise.resolve(undefined),
    stamp: (e: string) => (stamped.push(e), Promise.resolve()),
  }
  const params = { lang: 'es', email: 'a%40x.test' }

  const cooling = await handleOtpResendAction(ctx(params), {
    otpClient,
    notifier: 'sms',
    cooldown: { ...idle, endsAt: () => Promise.resolve(Date.now() + 10_000) },
  })
  assertEquals(location(cooling), '/es/login/otp/a%40x.test')
  assertEquals(dispatched, [])

  const failed = await handleOtpResendAction(ctx(params), {
    otpClient: { request: () => Promise.reject(upstream(500)) } as never,
    notifier: 'sms',
    cooldown: idle,
  })
  assertEquals(location(failed), '/es/login/otp/a%40x.test?error=unexpected_error')
  assertEquals(stamped, [])

  const sent = await handleOtpResendAction(ctx(params), {
    otpClient,
    notifier: 'sms',
    cooldown: idle,
  })
  assertEquals(location(sent), '/es/login/otp/a%40x.test?channel=sms')
  assertEquals(dispatched, [['a@x.test', 'sms']])
  assertEquals(stamped, ['a@x.test'])

  const fallback = await handleOtpResendAction(ctx(params), {
    otpClient,
    notifier: undefined,
    cooldown: idle,
  })
  assertEquals(location(fallback), '/es/login/otp/a%40x.test?channel=email')
})

Deno.test('markSessionRevoked: expires the access token as well as flipping the status', () => {
  const locals = { session: { subject: 'u1', payload: { sub: 'u1', exp: 999 }, status: 'active' } }
  markSessionRevoked({ ctx: undefined, session: locals.session, locals } as never)
  assertEquals(locals.session, {
    subject: 'u1',
    payload: { sub: 'u1', exp: 0 },
    status: 'revoked',
  })
})

function base64Url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A structurally real, unsigned JWT: `applySessionTokens` only decodes the tokens it applies. */
const fakeAccessToken = (sub: string) =>
  `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url({ sub })}.sig`

/** A context `applySessionTokens` accepts: it writes to `locals`. */
const sessionCtx = <T extends Record<string, string>>(params: T, path = '/') =>
  ctx(params, path, { id: 'test-request', locals: {}, cookies: {} })

Deno.test('handlePasswordLoginAction: success applies the session and lands where the app said', async () => {
  const response = await handlePasswordLoginAction(sessionCtx({}), {
    loginClient: {
      login: () =>
        Promise.resolve({
          accessToken: fakeAccessToken('u1'),
          refreshToken: 'refresh',
          expiresAt: 3600,
        }),
    } as never,
    email: 'a@x.test',
    password: 'secret',
    successPath: '/organization',
    failurePath: '/login?error=invalid-credentials',
  })
  assertEquals(response.status, 303)
  assertEquals(location(response), '/organization')
  response.headers.append('set-cookie', 'a=b') // headers stay mutable for the session interceptor
})

Deno.test('handlePasswordLoginAction: every way of not signing in returns to the failure path', async () => {
  const attempt = (login: () => Promise<unknown>) =>
    handlePasswordLoginAction(sessionCtx({}), {
      loginClient: { login } as never,
      email: 'a@x.test',
      password: 'wrong',
      successPath: '/organization',
      failurePath: '/login?error=invalid-credentials',
    })
  await Promise.all([
    () => Promise.reject(upstream(403)), // rejected credentials
    () => Promise.reject(upstream(502)), // upstream fault
    () => Promise.resolve({ message: 'a second factor is required' }), // a challenge, not tokens
  ].map(async (login) => {
    assertEquals(location(await attempt(login)), '/login?error=invalid-credentials')
  }))
  await assertRejects(() => attempt(() => Promise.reject(new TypeError('bug'))), TypeError)
})

Deno.test('handleTotpLoginAction: a valid code applies the session and lands on the app default', async () => {
  const response = await handleTotpLoginAction(sessionCtx({ lang: 'es', email: 'a%40x.test' }), {
    totpClient: {
      verifyLogin: () =>
        Promise.resolve({ accessToken: fakeAccessToken('u1'), refreshToken: 'r', expiresAt: 3600 }),
    } as never,
    code: '123456',
    defaultPath: '/es/home',
  })
  assertEquals(location(response), '/es/home')
})

Deno.test("handleTotpLoginAction: a valid code lands on the visitor's own redirect_to when it is safe", async () => {
  const totpClient = {
    verifyLogin: () =>
      Promise.resolve({ accessToken: fakeAccessToken('u1'), refreshToken: 'r', expiresAt: 3600 }),
  } as never
  const options = { totpClient, code: '1', defaultPath: '/es/home' }
  assertEquals(
    location(
      await handleTotpLoginAction(
        sessionCtx({ lang: 'es', email: 'a' }, '/?redirect_to=/es/orders'),
        options,
      ),
    ),
    '/es/orders',
  )
  assertEquals(
    location(
      await handleTotpLoginAction(
        sessionCtx({ lang: 'es', email: 'a' }, '/?redirect_to=//evil.test'),
        options,
      ),
    ),
    '/es/home',
  )
})

Deno.test('handleReactivateAction: success applies the session, seeds the cache best-effort, lands on the app default', async () => {
  const seeded: string[] = []
  const options = (cacheTokens: (subject: string) => Promise<void>) => ({
    loginClient: {
      confirmReactivation: () =>
        Promise.resolve({ accessToken: fakeAccessToken('u9'), refreshToken: 'r', expiresAt: 3600 }),
    } as never,
    defaultPath: '/es/home',
    cacheTokens,
  })
  const response = await handleReactivateAction(
    sessionCtx({ lang: 'es', token: 'tok' }),
    options((subject) => (seeded.push(subject), Promise.resolve())),
  )
  assertEquals(location(response), '/es/home')
  assertEquals(seeded, ['u9'])

  // A cache that fails never blocks the sign-in.
  const resilient = await handleReactivateAction(
    sessionCtx({ lang: 'es', token: 'tok' }),
    options(() => Promise.reject(new Error('cache down'))),
  )
  assertEquals(location(resilient), '/es/home')
})

// -- sign-in entry ----------------------------------------------------------------------------

const entryCtx = (path = '/') => sessionCtx({ lang: 'es' }, path)

const entry = (
  overrides: Partial<Parameters<typeof handleLoginEntryAction>[1]>,
  path = '/',
) =>
  handleLoginEntryAction(entryCtx(path), {
    loginClient: {
      getLoginMethods: () => Promise.resolve({ hasPassword: false }),
      login: () => Promise.reject(new Error('unexpected password login')),
    } as never,
    otpClient: { request: () => Promise.resolve() } as never,
    email: 'ana@x.test',
    defaultPath: '/es/home',
    ...overrides,
  })

Deno.test('loginEntryPageData: passwordless view props plus the password step, read off the request', () => {
  const data = loginEntryPageData(
    entryCtx('/?step=password&email=ana%40x.test&error=invalid_password&redirect_to=/es/orders'),
    { oauthProviders: ['google'], termsUrl: '/es/terms', privacyUrl: '/es/privacy' },
  )
  assertEquals(data.mode, 'passwordless')
  assertEquals([data.passwordStep, data.stepEmail, data.invalidPassword], [
    true,
    'ana@x.test',
    true,
  ])
  assertEquals(data.sessionExpired, false) // an error says why they came back
  assertEquals(data.oauthProviders, ['google'])
  assertEquals([data.termsUrl, data.privacyUrl], ['/es/terms', '/es/privacy'])
  assertEquals(data.clearQueryParamsOnRateLimitComplete, ['error', 'retryUntil'])
  assertEquals(data.nonce, 'nonce')

  const plain = loginEntryPageData(entryCtx('/?redirect_to=/es/orders'), { oauthProviders: [] })
  assertEquals([plain.passwordStep, plain.stepEmail, plain.sessionExpired], [false, '', true])
  const limited = loginEntryPageData(entryCtx('/?error=rate_limited&retryUntil=1700000000000'), {
    oauthProviders: [],
  })
  assertEquals([limited.rateLimited, limited.retryUntil], [true, 1700000000000])
  assertEquals(
    loginEntryPageData(entryCtx('/?error=no_account'), { oauthProviders: [] }).noAccount,
    true,
  )
  assertEquals(
    loginEntryPageData(entryCtx('/?error=unexpected_error'), { oauthProviders: [] })
      .unexpectedError,
    true,
  )
})

Deno.test('handleLoginEntryAction: an account with a password goes to the password step', async () => {
  const response = await entry(
    {
      loginClient: { getLoginMethods: () => Promise.resolve({ hasPassword: true }) } as never,
      otpClient: {
        request: () => Promise.reject(new Error('no code for a password account')),
      } as never,
      email: 'a+b@x.test',
    },
    '/?redirect_to=/es/orders',
  )
  assertEquals(
    location(response),
    '/es/login?step=password&email=a%2Bb%40x.test&redirect_to=%2Fes%2Forders',
  )
})

Deno.test('handleLoginEntryAction: any other account gets a code, a cooldown and the code page', async () => {
  const sent: string[] = []
  const stamped: string[] = []
  const response = await entry({
    otpClient: { request: (email: string) => (sent.push(email), Promise.resolve()) } as never,
    stampCooldown: (email) => (stamped.push(email), Promise.resolve()),
  }, '/?redirect_to=/es/orders')
  assertEquals(location(response), '/es/login/otp/ana%40x.test?redirect_to=%2Fes%2Forders')
  assertEquals([sent, stamped], [['ana@x.test'], ['ana@x.test']])
})

Deno.test('handleLoginEntryAction: a failing lookup does not stop the code; a rate-limited one does', async () => {
  const dispatched = await entry({
    loginClient: { getLoginMethods: () => Promise.reject(upstream(502)) } as never,
  })
  assertEquals(location(dispatched), '/es/login/otp/ana%40x.test')
  const limited = await entry({
    loginClient: { getLoginMethods: () => Promise.reject(upstream(429)) } as never,
  })
  assertEquals(location(limited).startsWith('/es/login?error=rate_limited'), true)
})

Deno.test('handleLoginEntryAction: a refused code reports the state, honouring open and closed registration', async () => {
  const refuse = (status: number) => ({
    otpClient: { request: () => Promise.reject(upstream(status)) } as never,
  })
  assertEquals(location(await entry(refuse(403))), '/es/login?error=no_account')
  assertEquals(
    location(await entry({ ...refuse(403), registration: 'open' })),
    '/es/login?error=no_account',
  )
  assertEquals(location(await entry(refuse(502))), '/es/login?error=unexpected_error')
  assertEquals(location(await entry(refuse(429))).startsWith('/es/login?error=rate_limited'), true)

  // Closed: which emails have an account is not for a stranger to learn.
  const stamped: string[] = []
  const closed = await entry({
    ...refuse(403),
    registration: 'closed',
    stampCooldown: (email) => (stamped.push(email), Promise.resolve()),
  })
  assertEquals(location(closed), '/es/login/otp/ana%40x.test')
  assertEquals(stamped, ['ana@x.test'])
  // ...but a real fault or a rate limit is still reported.
  assertEquals(
    location(await entry({ ...refuse(502), registration: 'closed' })),
    '/es/login?error=unexpected_error',
  )
  assertEquals(
    location(await entry({ ...refuse(429), registration: 'closed' })).startsWith(
      '/es/login?error=rate_limited',
    ),
    true,
  )
})

Deno.test('handleLoginEntryAction: a cooldown that fails never blocks the code page', async () => {
  const response = await entry({ stampCooldown: () => Promise.reject(new Error('cache down')) })
  assertEquals(location(response), '/es/login/otp/ana%40x.test')
})

Deno.test('handleLoginEntryAction: the delivery channels its own lookup returned are handed over, and a failing seed never blocks the code page', async () => {
  const seeded: [string, unknown][] = []
  const response = await entry({
    loginClient: {
      getLoginMethods: () =>
        Promise.resolve({ hasPassword: false, otpNotifier: 'whatsapp', hasVerifiedPhone: true }),
    } as never,
    seedNotifierMethods: (email, methods) => (seeded.push([email, methods]), Promise.resolve()),
  })
  assertEquals(location(response), '/es/login/otp/ana%40x.test')
  assertEquals(seeded.length, 1)
  assertEquals(seeded[0][0], 'ana@x.test')
  assertEquals((seeded[0][1] as { hasVerifiedPhone: boolean }).hasVerifiedPhone, true)

  const failing = await entry({
    seedNotifierMethods: () => Promise.reject(new Error('cache down')),
  })
  assertEquals(location(failing), '/es/login/otp/ana%40x.test')
})

Deno.test('handleLoginEntryAction: a non-upstream failure propagates', async () => {
  await assertRejects(
    () => entry({ otpClient: { request: () => Promise.reject(new TypeError('bug')) } as never }),
    TypeError,
  )
  await assertRejects(
    () =>
      entry({
        loginClient: { getLoginMethods: () => Promise.reject(new TypeError('bug')) } as never,
      }),
    TypeError,
  )
})

Deno.test('handleLoginEntryAction: a password sign-in lands on redirect_to or the default, seeding the cache', async () => {
  const seeded: string[] = []
  const login = () =>
    Promise.resolve({ accessToken: fakeAccessToken('u7'), refreshToken: 'r', expiresAt: 3600 })
  const options = {
    loginClient: { login } as never,
    password: 'secret',
    cacheTokens: (subject: string) => (seeded.push(subject), Promise.resolve()),
  }
  assertEquals(location(await entry(options)), '/es/home')
  assertEquals(location(await entry(options, '/?redirect_to=/es/orders')), '/es/orders')
  assertEquals(seeded, ['u7', 'u7'])
  // A cache that fails never blocks it.
  assertEquals(
    location(await entry({ ...options, cacheTokens: () => Promise.reject(new Error('down')) })),
    '/es/home',
  )
})

Deno.test('handleLoginEntryAction: a password refusal returns to the password step with its state', async () => {
  const password = (status: number) =>
    entry({
      loginClient: { login: () => Promise.reject(upstream(status)) } as never,
      password: 'x',
    }, '/?redirect_to=/es/orders')
  const step = 'step=password&email=ana%40x.test'
  assertEquals(
    location(await password(403)),
    `/es/login?${step}&error=invalid_password&redirect_to=%2Fes%2Forders`,
  )
  assertEquals(
    location(await password(429)).startsWith(`/es/login?${step}&error=rate_limited`),
    true,
  )
  assertEquals(
    location(await password(502)),
    `/es/login?${step}&error=unexpected_error&redirect_to=%2Fes%2Forders`,
  )
})

Deno.test('handleLoginEntryAction: an account that needs a second factor goes to the authenticator page', async () => {
  const response = await entry(
    {
      loginClient: {
        login: () =>
          Promise.resolve({ message: 'second factor', email: 'jane@example.com', method: 'totp' }),
      } as never,
      password: 'secret',
    },
    '/?redirect_to=/es/orders',
  )
  assertEquals(location(response), '/es/login/totp/ana%40x.test?redirect_to=%2Fes%2Forders')
})

Deno.test('handleLoginEntryAction: an account whose second factor is a sent code goes to the code page', async () => {
  const response = await entry(
    {
      loginClient: {
        login: () =>
          Promise.resolve({ message: 'code sent', email: 'ana@x.test', method: 'email' }),
      } as never,
      password: 'secret',
    },
    '/?redirect_to=/es/orders',
  )
  assertEquals(location(response), '/es/login/otp/ana%40x.test?redirect_to=%2Fes%2Forders')
})

Deno.test('handleLoginEntryAction: the app chooses its own pages', async () => {
  const response = await entry({
    paths: {
      login: (lang) => `/${lang}/sign-in`,
      otp: (lang, email) => `/${lang}/code/${encodeURIComponent(email)}`,
    },
  })
  assertEquals(location(response), '/es/code/ana%40x.test')
  const refused = await entry({
    paths: { login: (lang) => `/${lang}/sign-in` },
    otpClient: { request: () => Promise.reject(upstream(403)) } as never,
  })
  assertEquals(location(refused), '/es/sign-in?error=no_account')
})

Deno.test('a client given as a function is built only by a branch that needs it', async () => {
  const built: string[] = []
  const loginClient = () => {
    built.push('login')
    return {
      login: () =>
        Promise.resolve({ accessToken: fakeAccessToken('u1'), refreshToken: 'r', expiresAt: 1 }),
    } as never
  }
  const otpClient = () => {
    built.push('otp')
    return { request: () => Promise.resolve() } as never
  }

  // A password sign-in never needs the one-time-code client.
  await entry({ loginClient, otpClient, password: 'secret' })
  assertEquals(built, ['login'])

  // A resend that is still cooling down dispatches nothing, so it never builds the client either.
  built.length = 0
  await handleOtpResendAction(sessionCtx({ lang: 'es', email: 'a%40x.test' }), {
    otpClient,
    notifier: 'sms',
    cooldown: {
      endsAt: () => Promise.resolve(Date.now() + 10_000),
      stamp: () => Promise.resolve(),
    },
  })
  assertEquals(built, [])
})

// -- one-time code: verify ---------------------------------------------------------------------

const otpCtx = (path = '/') => sessionCtx({ lang: 'es', email: 'ana%40x.test' }, path)
const noEnrichment = {
  cooldownEndsAt: () => Promise.resolve(undefined),
  notifierMethods: () => Promise.resolve({ otpNotifier: null, hasVerifiedPhone: false }),
}

Deno.test('otpVerifyPageData: the state of the code page, read off the request and the two lookups', async () => {
  const data = await otpVerifyPageData(
    otpCtx('/?error=invalid_code&channel=whatsapp'),
    {
      cooldownEndsAt: () => Promise.resolve(1700000000000),
      notifierMethods: () => Promise.resolve({ otpNotifier: 'sms', hasVerifiedPhone: true }),
    },
  )
  assertEquals(data.email, 'ana@x.test')
  assertEquals([data.invalidCode, data.cooldownEndsAt], [true, 1700000000000])
  assertEquals([data.otpNotifier, data.hasVerifiedPhone], ['sms', true])
  assertEquals(data.sentToChannel, 'whatsapp') // a valid ?channel= beats the account's own
  assertEquals(data.clearQueryParamsOnRateLimitComplete, ['error', 'retryUntil'])

  const account = await otpVerifyPageData(otpCtx(), {
    ...noEnrichment,
    notifierMethods: () => Promise.resolve({ otpNotifier: 'sms', hasVerifiedPhone: true }),
  })
  assertEquals(account.sentToChannel, 'sms')
  assertEquals(
    (await otpVerifyPageData(otpCtx('/?channel=bogus'), noEnrichment)).sentToChannel,
    'email',
  )

  const limited = await otpVerifyPageData(
    otpCtx('/?error=rate_limited&retryUntil=1700000000000'),
    noEnrichment,
  )
  assertEquals([limited.rateLimited, limited.retryUntil], [true, 1700000000000])
  assertEquals(
    (await otpVerifyPageData(otpCtx('/?error=unexpected_error'), noEnrichment)).unexpectedError,
    true,
  )
})

Deno.test('otpVerifyPageData: a failing cooldown or channel lookup shows the page without it', async () => {
  const data = await otpVerifyPageData(otpCtx(), {
    cooldownEndsAt: () => Promise.reject(new Error('cache down')),
    notifierMethods: () => Promise.reject(new Error('iam down')),
  })
  assertEquals(
    [data.cooldownEndsAt, data.otpNotifier, data.hasVerifiedPhone, data.sentToChannel],
    [undefined, null, false, 'email'],
  )
})

const verify = (verifyCall: () => Promise<unknown>, path = '/', extra = {}) =>
  handleOtpVerifyAction(otpCtx(path), {
    otpClient: { verify: verifyCall } as never,
    code: '123456',
    defaultPath: '/es/home',
    ...extra,
  })

Deno.test('handleOtpVerifyAction: every refusal returns to the code page keeping redirect_to and the pending channel', async () => {
  const path = '/?redirect_to=/es/orders&channel=sms'
  const tail = 'redirect_to=%2Fes%2Forders&channel=sms'
  assertEquals(
    location(await verify(() => Promise.reject(upstream(403)), path)),
    `/es/login/otp/ana%40x.test?error=invalid_code&${tail}`,
  )
  assertEquals(
    location(await verify(() => Promise.reject(upstream(502)), path)),
    `/es/login/otp/ana%40x.test?error=unexpected_error&${tail}`,
  )
  const limited = location(await verify(() => Promise.reject(upstream(429)), path))
  assertEquals(limited.startsWith('/es/login/otp/ana%40x.test?error=rate_limited'), true)
  assertEquals(limited.endsWith(tail), true)
  assertEquals(
    location(await verify(() => Promise.reject(upstream(403)))),
    '/es/login/otp/ana%40x.test?error=invalid_code', // no redirect_to, no channel: nothing to carry
  )
})

Deno.test('handleOtpVerifyAction: an inactive account goes to reactivation, one with a second factor to the authenticator', async () => {
  assertEquals(
    location(
      await verify(() =>
        Promise.resolve({ needsReactivationConfirm: true, reactivationToken: 'a.b-c' })
      ),
    ),
    '/es/login/reactivate/a.b-c',
  )
  assertEquals(
    location(
      await verify(
        () =>
          Promise.resolve({ message: 'second factor', email: 'jane@example.com', method: 'totp' }),
        '/?redirect_to=/es/orders',
      ),
    ),
    '/es/login/totp/ana%40x.test?redirect_to=%2Fes%2Forders',
  )
})

Deno.test('handleOtpVerifyAction: success lands on redirect_to or the default, seeding the cache', async () => {
  const seeded: string[] = []
  const ok = () =>
    Promise.resolve({ accessToken: fakeAccessToken('u3'), refreshToken: 'r', expiresAt: 1 })
  const options = { cacheTokens: (subject: string) => (seeded.push(subject), Promise.resolve()) }
  assertEquals(location(await verify(ok, '/', options)), '/es/home')
  assertEquals(location(await verify(ok, '/?redirect_to=/es/orders', options)), '/es/orders')
  assertEquals(seeded, ['u3', 'u3'])
  assertEquals(
    location(await verify(ok, '/', { cacheTokens: () => Promise.reject(new Error('down')) })),
    '/es/home',
  )
  await assertRejects(() => verify(() => Promise.reject(new TypeError('bug'))), TypeError)
})

Deno.test('handleOtpVerifyAction: the app chooses its own pages', async () => {
  const paths = {
    otp: (lang: string, email: string) => `/${lang}/code/${encodeURIComponent(email)}`,
    totp: (lang: string, email: string) => `/${lang}/2fa/${encodeURIComponent(email)}`,
    reactivate: (lang: string, token: string) => `/${lang}/wake/${token}`,
  }
  assertEquals(
    location(await verify(() => Promise.reject(upstream(403)), '/', { paths })),
    '/es/code/ana%40x.test?error=invalid_code',
  )
  assertEquals(
    location(
      await verify(
        () => Promise.resolve({ message: 'x', email: 'jane@example.com', method: 'totp' }),
        '/',
        { paths },
      ),
    ),
    '/es/2fa/ana%40x.test',
  )
  assertEquals(
    location(
      await verify(
        () => Promise.resolve({ needsReactivationConfirm: true, reactivationToken: 't' }),
        '/',
        { paths },
      ),
    ),
    '/es/wake/t',
  )
})

Deno.test('handleLoginMethodsAction: answers whether the email has a password', async () => {
  const response = await handleLoginMethodsAction({
    loginClient: () => ({ getLoginMethods: () => Promise.resolve({ hasPassword: true }) }) as never,
    email: 'a@example.com',
  })
  assertEquals(response.headers.get('content-type'), 'application/json')
  assertEquals(await response.json(), { hasPassword: true })
})

Deno.test('handleLoginMethodsAction: an upstream failure answers false, never an error', async () => {
  const response = await handleLoginMethodsAction({
    loginClient: () => ({ getLoginMethods: () => Promise.reject(upstream(503)) }) as never,
    email: 'a@example.com',
  })
  assertEquals(await response.json(), { hasPassword: false })
})

Deno.test('handleLoginMethodsAction: a fault that is not an upstream one propagates', async () => {
  await assertRejects(() =>
    handleLoginMethodsAction({
      loginClient: () => ({ getLoginMethods: () => Promise.reject(new TypeError('bug')) }) as never,
      email: 'a@example.com',
    }), TypeError)
})

Deno.test('handleRecoveryRequestAction: requests the code and continues at the callback path', async () => {
  const requested: string[] = []
  const response = await handleRecoveryRequestAction(ctx({ lang: 'es' }), {
    passwordClient: () =>
      ({
        requestRecovery: (email: string) => {
          requested.push(email)
          return Promise.resolve({ message: 'ok' })
        },
      }) as never,
    email: 'a+b@example.com',
    callbackPath: (email) => `/es/recovery/callback?email=${encodeURIComponent(email)}`,
  })
  assertEquals(requested, ['a+b@example.com'])
  assertEquals(response.status, 303)
  assertEquals(
    location(response),
    'https://app.test/es/recovery/callback?email=a%2Bb%40example.com',
  )
})

const withSession = (cookie: string | undefined, accessToken: string | undefined) =>
  ctx({ lang: 'es' }, '/', {
    request: new Request('http://localhost/es/logout', { headers: cookie ? { cookie } : {} }),
    session: accessToken ? { accessToken } : undefined,
    locals: {},
  })

Deno.test('handleLogoutAction: revokes the session at iam, marks it revoked and redirects', async () => {
  let revoked: [string, string | undefined] | undefined
  const context = withSession('X-Znx-App-Token=the-refresh', 'the-access')
  const response = await handleLogoutAction(context as never, {
    loginClient: () =>
      ({
        logout: (access: string, refresh?: string) => {
          revoked = [access, refresh]
          return Promise.resolve({ message: 'ok' })
        },
      }) as never,
    redirectTo: '/es/login',
  })
  assertEquals(revoked, ['the-access', 'the-refresh'])
  assertEquals(
    (context as { locals: Record<string, { status?: string }> }).locals.session?.status,
    'revoked',
  )
  assertEquals([response.status, location(response)], [303, '/es/login'])
})

Deno.test('handleLogoutAction: with no cookie or access token it calls nothing and still redirects', async () => {
  let called = false
  const client = () => ({ logout: () => ((called = true), Promise.resolve({})) }) as never
  for (
    const context of [withSession(undefined, 'a'), withSession('X-Znx-App-Token=r', undefined)]
  ) {
    // deno-lint-ignore no-await-in-loop
    const response = await handleLogoutAction(context as never, {
      loginClient: client,
      redirectTo: '/es/login',
    })
    assertEquals(location(response), '/es/login')
  }
  assertEquals(called, false)
})
