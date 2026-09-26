/**
 * @module
 *
 * The loader and action logic of the login-flow pages an app renders itself around `iam`'s views —
 * the `./space/login-pages` subpath. Each function is the body of a page's `loader` or `action`:
 * the app keeps the page class (route, decorators, head, layout, messages) and calls these, so
 * what is written once here is what every app runs, and everything that identifies an app — its
 * clients, landing page, layout, message catalog, styles — stays the app's own.
 *
 * Nothing here renders markup or reads a message: the views this logic feeds are `iam`'s
 * `ui/pages/*`, which take their text and styling from the consumer.
 */
import type { PageActionContext, PageContext } from '@zanix/space'
import type { ScopedContext } from '@zanix/server'
import { RestClientError, SESSION_HEADERS } from '@zanix/server'
import { getCookies } from 'jsr:@std/http@0.224/cookie'
import {
  applySessionTokens,
  decodeJWT,
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_STATE_MAX_AGE_SECONDS,
} from '@zanix/auth'
import { HttpError } from '@zanix/errors'
import type { LoginClient } from '../sdk/client/login.client.ts'
import type { OtpClient } from '../sdk/client/otp.client.ts'
import type { PasswordClient } from '../sdk/client/password.client.ts'
import type { TotpClient } from '../sdk/client/totp.client.ts'
import type { RefreshResult } from '../sdk/rtos/login.ts'
import { OAUTH_PROVIDERS } from '../sdk/rtos/common.ts'
import type { OauthProvider } from '../sdk/rtos/common.ts'
import type { TotpViewProps } from '../pages/login-totp/types.ts'
import type { LoginEntryData } from '../pages/login-entry/types.ts'
import type { OauthStartViewProps } from '../pages/login-oauth-start/types.ts'
import {
  buildRateLimitedQuery,
  decodeEmailParam,
  INVALID_CODE_ERROR,
  NO_ACCOUNT_ERROR,
  parseRetryUntil,
  RATE_LIMITED_ERROR,
  readLoginErrorState,
  redirectResponse,
  resolvePostLoginRedirect,
  RETRY_UNTIL_PARAM,
  UNEXPECTED_ERROR,
  withRedirectToParam,
} from '../sdk/login-flow.ts'
import type { OtpChannel } from '../sdk/otp-channel.ts'
import {
  OTP_CHANNEL_PARAM,
  parseOtpChannel,
  resolveOtpChannel,
  withOtpChannelParam,
} from '../sdk/otp-channel.ts'
import type { NotifierMethods } from '../sdk/otp-flow-cache.ts'

/** A client, or a function that builds it. A function is called only when a branch needs the
 * client, so an app whose client construction reads a required setting fails only on the requests
 * that really use it. */
export type LazyClient<T> = T | (() => T)

function client<T>(value: LazyClient<T>): T {
  return typeof value === 'function' ? (value as () => T)() : value
}

/** Query param a reactivation page's `action` redirects back with on an invalid or expired token. */
export const REACTIVATE_EXPIRED_ERROR = 'expired'

// -- sign-in entry: email first, then a password or a one-time code ------------------------------

/** Query param carrying the step of the entry page. */
export const LOGIN_STEP_PARAM = 'step'

/** The value of {@linkcode LOGIN_STEP_PARAM} that shows the password step. */
export const LOGIN_PASSWORD_STEP = 'password'

/** Query param carrying the email the password step is for. */
export const LOGIN_STEP_EMAIL_PARAM = 'email'

/** `error` value: the password step's password was rejected. */
export const INVALID_PASSWORD_ERROR = 'invalid_password'

/** The `loader` data of a two-step sign-in page — see {@linkcode LoginEntryData}. */
export type LoginEntryPageData = LoginEntryData

/** Route params of the sign-in entry page (`/{lang}/login`). */
export type LoginEntryParams = { lang: string }

/**
 * The `loader` data of a two-step sign-in page: everything `LoginView` (passwordless mode) takes
 * except the message catalog, plus the state of the password step.
 * @param options.oauthProviders - The providers this app offers. Which ones exist is the app's own
 * decision (its environment, its product), never derived here.
 * @param options.termsUrl - The terms link shown by the view, if any.
 * @param options.privacyUrl - The privacy link shown by the view, if any.
 */
export function loginEntryPageData(
  ctx: PageContext<LoginEntryParams>,
  options: { oauthProviders: readonly OauthProvider[]; termsUrl?: string; privacyUrl?: string },
): LoginEntryPageData {
  const error = ctx.url.searchParams.get('error')
  return {
    lang: ctx.params.lang,
    mode: 'passwordless',
    csrfToken: ctx.csrfToken,
    fieldErrors: ctx.fieldErrors,
    submitted: ctx.submitted,
    invalidCredentials: false,
    passwordStep: ctx.url.searchParams.get(LOGIN_STEP_PARAM) === LOGIN_PASSWORD_STEP,
    stepEmail: ctx.url.searchParams.get(LOGIN_STEP_EMAIL_PARAM) ?? '',
    invalidPassword: error === INVALID_PASSWORD_ERROR,
    noAccount: error === NO_ACCOUNT_ERROR,
    rateLimited: error === RATE_LIMITED_ERROR,
    unexpectedError: error === UNEXPECTED_ERROR,
    retryUntil: parseRetryUntil(ctx.url),
    clearQueryParamsOnRateLimitComplete: ['error', RETRY_UNTIL_PARAM],
    oauthProviders: options.oauthProviders,
    sessionExpired: ctx.url.searchParams.has('redirect_to') && !error,
    termsUrl: options.termsUrl,
    privacyUrl: options.privacyUrl,
    nonce: ctx.cspNonce,
  }
}

/**
 * The `action` of a two-step sign-in page. With only an email it looks up how the account can sign
 * in: an account with a password goes to the password step, any other gets a one-time code and goes
 * to the code page. With a password it signs in, or sends an account that needs a second factor to
 * the authenticator page. Every upstream refusal returns to the entry page with the matching state,
 * keeping `redirect_to`.
 * @param options.defaultPath - The landing page when there is no `redirect_to`.
 * @param options.registration - `'open'`: an email nobody registered reports "no account".
 * `'closed'`: the accounts were created beforehand, so the answer must not reveal which emails
 * exist: an unknown email goes to the code page like any other, and no code ever arrives.
 * @default 'open'
 * @param options.cacheTokens - Seeds the app's session-refresh cache with the issued pair. Best
 * effort.
 * @param options.stampCooldown - Starts the resend cooldown after a code was sent. Best effort.
 * @param options.seedNotifierMethods - Stores the delivery channels this action's own lookup
 * returned, so the code screen it redirects to does not repeat a rate-limited lookup. Best effort.
 * @param options.paths - The app's own pages; by default `/{lang}/login`, `/{lang}/login/otp/{email}`
 * and `/{lang}/login/totp/{email}`.
 */
export async function handleLoginEntryAction(
  ctx: PageActionContext<LoginEntryParams>,
  options: {
    loginClient: LazyClient<LoginClient>
    otpClient: LazyClient<OtpClient>
    email: string
    password?: string
    defaultPath: string
    registration?: 'open' | 'closed'
    cacheTokens?: (subject: string, tokens: RefreshResult) => Promise<void>
    stampCooldown?: (email: string) => Promise<void>
    seedNotifierMethods?: (email: string, methods: NotifierMethods) => Promise<void>
    paths?: {
      login?: (lang: string) => string
      otp?: (lang: string, email: string) => string
      totp?: (lang: string, email: string) => string
    }
  },
): Promise<Response> {
  const { lang } = ctx.params
  const { email, password } = options
  const loginPath = (options.paths?.login ?? ((l: string) => `/${l}/login`))(lang)
  const otpPath =
    (options.paths?.otp ?? ((l: string, e: string) => `/${l}/login/otp/${encodeURIComponent(e)}`))(
      lang,
      email,
    )
  const totpPath = (options.paths?.totp ??
    ((l: string, e: string) => `/${l}/login/totp/${encodeURIComponent(e)}`))(lang, email)
  const back = (query: string) =>
    redirectResponse(withRedirectToParam(`${loginPath}?${query}`, ctx.url))

  if (password) {
    const stepQuery = `${LOGIN_STEP_PARAM}=${LOGIN_PASSWORD_STEP}&${LOGIN_STEP_EMAIL_PARAM}=${
      encodeURIComponent(email)
    }`
    let result: Awaited<ReturnType<LoginClient['login']>>
    try {
      result = await client(options.loginClient).login(email, password)
    } catch (e) {
      if (!(e instanceof RestClientError)) throw e
      if (e.realHttpStatus === 403) return back(`${stepQuery}&error=${INVALID_PASSWORD_ERROR}`)
      if (e.realHttpStatus === 429) return back(`${stepQuery}&${buildRateLimitedQuery(e)}`)
      return back(`${stepQuery}&error=${UNEXPECTED_ERROR}`)
    }

    if (!('accessToken' in result)) {
      return redirectResponse(
        withRedirectToParam(result.method === 'totp' ? totpPath : otpPath, ctx.url),
      )
    }

    applySessionTokens(ctx as unknown as ScopedContext, result)
    let subject: string | undefined
    try {
      subject = decodeJWT(result.accessToken).payload.sub as string | undefined
    } catch {
      subject = undefined
    }
    if (subject && options.cacheTokens) {
      try {
        await options.cacheTokens(subject, result)
      } catch {
        // Best effort: a cold cache only costs one extra refresh on the first guarded page.
      }
    }
    return redirectResponse(resolvePostLoginRedirect(ctx.url, options.defaultPath))
  }

  try {
    const methods = await client(options.loginClient).getLoginMethods(email)
    if (options.seedNotifierMethods) {
      try {
        await options.seedNotifierMethods(email, methods)
      } catch {
        // Best effort: without it the code screen makes its own lookup.
      }
    }
    if (methods.hasPassword) {
      return redirectResponse(
        withRedirectToParam(
          `${loginPath}?${LOGIN_STEP_PARAM}=${LOGIN_PASSWORD_STEP}&${LOGIN_STEP_EMAIL_PARAM}=${
            encodeURIComponent(email)
          }`,
          ctx.url,
        ),
      )
    }
  } catch (e) {
    if (!(e instanceof RestClientError)) throw e
    // A failed lookup is not a reason to stop: the code is the method every account has.
    if (e.realHttpStatus === 429) return back(buildRateLimitedQuery(e))
  }

  try {
    await client(options.otpClient).request(email)
  } catch (e) {
    if (!(e instanceof RestClientError)) throw e
    if (e.realHttpStatus === 403 && options.registration !== 'closed') {
      return back(`error=${NO_ACCOUNT_ERROR}`)
    }
    if (e.realHttpStatus === 429) return back(buildRateLimitedQuery(e))
    // On a closed instance a refusal for "no account" is answered like a sent code.
    if (!(e.realHttpStatus === 403 && options.registration === 'closed')) {
      return back(`error=${UNEXPECTED_ERROR}`)
    }
  }

  if (options.stampCooldown) {
    try {
      await options.stampCooldown(email)
    } catch {
      // Best effort: without a cooldown the resend button just is not throttled for this address.
    }
  }

  return redirectResponse(withRedirectToParam(otpPath, ctx.url))
}

// -- one-time code: verify ------------------------------------------------------------------------

/** Route params of the OTP verification page (`/{lang}/login/otp/{email}`). */
export type OtpVerifyParams = { lang: string; email: string }

/** The `loader` data of the code page: everything the app's view needs except the message
 * catalog. */
export type OtpVerifyPageData = {
  lang: string
  email: string
  csrfToken?: string
  /** The code was rejected. */
  invalidCode: boolean
  /** The instant the resend cooldown ends, `undefined` when none is active. */
  cooldownEndsAt?: number
  /** The account's own delivery channel, `null` for email. */
  otpNotifier: NotifierMethods['otpNotifier']
  /** The account has a verified phone, so another channel can be offered. */
  hasVerifiedPhone: boolean
  /** The channel the pending code was sent through: a valid `?channel=` wins over the account's. */
  sentToChannel: OtpChannel
  rateLimited: boolean
  unexpectedError: boolean
  retryUntil?: number
  clearQueryParamsOnRateLimitComplete: string[]
  nonce?: string
}

/**
 * The `loader` data of the code page. The cooldown and the delivery-channel lookup are enrichments:
 * a failure of either shows the page without them instead of failing it.
 * @param options.cooldownEndsAt - Reads the resend cooldown of an address.
 * @param options.notifierMethods - Reads which channels an address can receive a code on.
 */
export async function otpVerifyPageData(
  ctx: PageContext<OtpVerifyParams>,
  options: {
    cooldownEndsAt: (email: string) => Promise<number | undefined>
    notifierMethods: (email: string) => Promise<NotifierMethods>
  },
): Promise<OtpVerifyPageData> {
  const email = decodeEmailParam(ctx.params.email)

  let cooldownEndsAt: number | undefined
  try {
    cooldownEndsAt = await options.cooldownEndsAt(email)
  } catch {
    cooldownEndsAt = undefined
  }

  let otpNotifier: NotifierMethods['otpNotifier'] = null
  let hasVerifiedPhone = false
  try {
    const methods = await options.notifierMethods(email)
    otpNotifier = methods.otpNotifier
    hasVerifiedPhone = methods.hasVerifiedPhone
  } catch {
    // Without the lookup the page offers email only.
  }

  const { rateLimited, unexpectedError } = readLoginErrorState(ctx.url)
  return {
    lang: ctx.params.lang,
    email,
    csrfToken: ctx.csrfToken,
    invalidCode: ctx.url.searchParams.get('error') === INVALID_CODE_ERROR,
    rateLimited,
    unexpectedError,
    retryUntil: parseRetryUntil(ctx.url),
    clearQueryParamsOnRateLimitComplete: ['error', RETRY_UNTIL_PARAM],
    nonce: ctx.cspNonce,
    cooldownEndsAt,
    otpNotifier,
    hasVerifiedPhone,
    sentToChannel: resolveOtpChannel(ctx.url.searchParams, otpNotifier ?? 'email'),
  }
}

/**
 * The `action` of the code page. A rejected code, a rate limit and any other upstream fault return
 * to the same page with the matching state, keeping `redirect_to` and the pending `?channel=`. An
 * inactive account goes to the reactivation page with the token `iam` issued, an account that also
 * needs a second factor to the authenticator page, and success applies the session and lands on
 * `defaultPath` (or the visitor's own `redirect_to`).
 * @param options.cacheTokens - Seeds the app's session-refresh cache. Best effort.
 * @param options.paths - The app's own pages; by default `/{lang}/login/otp/{email}`,
 * `/{lang}/login/totp/{email}` and `/{lang}/login/reactivate/{token}`.
 */
export async function handleOtpVerifyAction(
  ctx: PageActionContext<OtpVerifyParams>,
  options: {
    otpClient: LazyClient<OtpClient>
    code: string
    defaultPath: string
    cacheTokens?: (subject: string, tokens: RefreshResult) => Promise<void>
    paths?: {
      otp?: (lang: string, email: string) => string
      totp?: (lang: string, email: string) => string
      reactivate?: (lang: string, token: string) => string
    }
  },
): Promise<Response> {
  const { lang } = ctx.params
  const email = decodeEmailParam(ctx.params.email)
  const basePath = (options.paths?.otp ??
    ((l: string, e: string) => `/${l}/login/otp/${encodeURIComponent(e)}`))(lang, email)
  const pendingChannel = parseOtpChannel(ctx.url.searchParams.get(OTP_CHANNEL_PARAM))
  const back = (query: string) =>
    redirectResponse(
      withOtpChannelParam(withRedirectToParam(`${basePath}?${query}`, ctx.url), pendingChannel),
    )

  let result: Awaited<ReturnType<OtpClient['verify']>>
  try {
    result = await client(options.otpClient).verify(email, options.code)
  } catch (e) {
    if (!(e instanceof RestClientError)) throw e
    if (e.realHttpStatus === 403) return back(`error=${INVALID_CODE_ERROR}`)
    if (e.realHttpStatus === 429) return back(buildRateLimitedQuery(e))
    return back(`error=${UNEXPECTED_ERROR}`)
  }

  if ('needsReactivationConfirm' in result) {
    return redirectResponse(
      (options.paths?.reactivate ??
        ((l: string, token: string) => `/${l}/login/reactivate/${encodeURIComponent(token)}`))(
          lang,
          result.reactivationToken,
        ),
    )
  }

  if (!('accessToken' in result)) {
    const secondFactorPath = result.method === 'totp'
      ? (options.paths?.totp ??
        ((l: string, e: string) => `/${l}/login/totp/${encodeURIComponent(e)}`))(lang, email)
      : (options.paths?.otp ??
        ((l: string, e: string) => `/${l}/login/otp/${encodeURIComponent(e)}`))(lang, email)
    return redirectResponse(withRedirectToParam(secondFactorPath, ctx.url))
  }

  applySessionTokens(ctx as unknown as ScopedContext, result)
  let subject: string | undefined
  try {
    subject = decodeJWT(result.accessToken).payload.sub as string | undefined
  } catch {
    subject = undefined
  }
  if (subject && options.cacheTokens) {
    try {
      await options.cacheTokens(subject, result)
    } catch {
      // Best effort: a cold cache only costs one extra refresh on the first guarded page.
    }
  }

  return redirectResponse(resolvePostLoginRedirect(ctx.url, options.defaultPath))
}

// -- two-step lookup and password recovery ------------------------------------------------------

/**
 * The `action` of the methods endpoint a two-step sign-in asks (through `LoginTwoStep`) whether an
 * email has a password: answers `{ hasPassword }` as JSON. An unknown email and an email without a
 * password answer the same `false`, and an upstream failure also answers `false`, so the lookup
 * never reveals whether an account exists and the sign-in form's own submit stays the decision.
 */
export async function handleLoginMethodsAction(
  options: { loginClient: LazyClient<LoginClient>; email: string },
): Promise<Response> {
  let hasPassword = false
  try {
    hasPassword = (await client(options.loginClient).getLoginMethods(options.email)).hasPassword
  } catch (e) {
    if (!(e instanceof RestClientError)) throw e
  }
  return new Response(JSON.stringify({ hasPassword }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * The `action` of a "forgot password" form: asks for a recovery code to be sent and redirects to
 * `callbackPath`, the page where the code is entered.
 * @param options.callbackPath - Where the visitor continues, given the address the code went to.
 */
export async function handleRecoveryRequestAction(
  ctx: PageActionContext<Record<string, string>>,
  options: {
    passwordClient: LazyClient<PasswordClient>
    email: string
    callbackPath: (email: string) => string
  },
): Promise<Response> {
  await client(options.passwordClient).requestRecovery(options.email)
  return redirectResponse(new URL(options.callbackPath(options.email), ctx.url))
}

// -- sign-out ------------------------------------------------------------------------------------

/**
 * The `action` of a sign-out page: ends the session at `iam` (`LoginClient.logout`, which revokes
 * the refresh token there — the source of truth for a session being over), marks the local session
 * revoked so the response clears its cookies, and redirects to `redirectTo`. Nothing is called when
 * the request carries no session, and a failed call to `iam` propagates.
 * @param options.redirectTo - Where the visitor lands afterwards, e.g. the login page.
 */
export async function handleLogoutAction(
  ctx: PageActionContext<Record<string, string>>,
  options: { loginClient: LazyClient<LoginClient>; redirectTo: string },
): Promise<Response> {
  const refreshToken = getCookies(ctx.request.headers)[SESSION_HEADERS.user.token as string]
  const accessToken = ctx.session?.accessToken as string | undefined
  if (refreshToken && accessToken) {
    await client(options.loginClient).logout(accessToken, refreshToken)
  }
  markSessionRevoked(ctx)
  return redirectResponse(options.redirectTo)
}

// -- password sign-in ---------------------------------------------------------------------------

/**
 * The `action` of a password-only sign-in page: signs the visitor in, applies the session and
 * redirects to `successPath`. Rejected credentials, any other upstream fault and an account that
 * needs a second factor (which a password-only page cannot ask for) redirect to `failurePath`, so
 * the page shows one "could not sign in" state instead of a raw error.
 * @param options.failurePath - Where a failed attempt goes, e.g. `/login?error=invalid-credentials`.
 * @param options.successPath - Where a successful sign-in lands.
 */
export async function handlePasswordLoginAction(
  ctx: PageActionContext<Record<string, string>>,
  options: {
    loginClient: LazyClient<LoginClient>
    email: string
    password: string
    successPath: string
    failurePath: string
  },
): Promise<Response> {
  let result: Awaited<ReturnType<LoginClient['login']>>
  try {
    result = await client(options.loginClient).login(options.email, options.password)
  } catch (e) {
    if (e instanceof RestClientError) return redirectResponse(options.failurePath)
    throw e
  }
  if (!('accessToken' in result)) return redirectResponse(options.failurePath)

  applySessionTokens(ctx as unknown as ScopedContext, result)
  return redirectResponse(options.successPath)
}

// -- second factor: authenticator code ---------------------------------------------------------

/** Route params of the TOTP login page (`/{lang}/login/totp/{email}`). */
export type TotpParams = { lang: string; email: string }

/** The `loader` data of the authenticator-code page — everything `TotpLoginView` takes except the
 * message catalog, which the app loads. */
export function totpLoginPageData(ctx: PageContext<TotpParams>): TotpViewProps {
  const { rateLimited, unexpectedError } = readLoginErrorState(ctx.url)
  return {
    lang: ctx.params.lang,
    email: decodeEmailParam(ctx.params.email),
    csrfToken: ctx.csrfToken,
    fieldErrors: ctx.fieldErrors,
    invalidCode: ctx.url.searchParams.get('error') === INVALID_CODE_ERROR,
    rateLimited,
    unexpectedError,
    retryUntil: parseRetryUntil(ctx.url),
    clearQueryParamsOnRateLimitComplete: ['error', RETRY_UNTIL_PARAM],
    nonce: ctx.cspNonce,
  }
}

/**
 * The `action` of the authenticator-code page. A rejected code (`403`), a rate limit (`429`) and
 * any other upstream fault redirect back to the same screen with the matching state, carrying the
 * visitor's `redirect_to` along; success applies the session and lands on `defaultPath` (or the
 * visitor's own `redirect_to`).
 * @param code - The submitted code.
 * @param defaultPath - The landing page when no `redirect_to` was given.
 */
export async function handleTotpLoginAction(
  ctx: PageActionContext<TotpParams>,
  options: { totpClient: LazyClient<TotpClient>; code: string; defaultPath: string },
): Promise<Response> {
  const { lang } = ctx.params
  const email = decodeEmailParam(ctx.params.email)
  const basePath = `/${lang}/login/totp/${encodeURIComponent(email)}`

  try {
    const tokens = await client(options.totpClient).verifyLogin(email, options.code)
    applySessionTokens(ctx as unknown as ScopedContext, tokens)
  } catch (e) {
    if (!(e instanceof RestClientError)) throw e
    const query = e.realHttpStatus === 403
      ? `error=${INVALID_CODE_ERROR}`
      : e.realHttpStatus === 429
      ? buildRateLimitedQuery(e)
      : `error=${UNEXPECTED_ERROR}`
    return redirectResponse(withRedirectToParam(`${basePath}?${query}`, ctx.url))
  }

  return redirectResponse(resolvePostLoginRedirect(ctx.url, options.defaultPath))
}

// -- OAuth2 -------------------------------------------------------------------------------------

/** Route params of the OAuth2 start page (`/{lang}/login/{oauth}`). */
export type OauthParams = { lang: string; oauth: string }

/** The `loader` data of the OAuth2 start page. Throws `NOT_FOUND` for a provider `iam` does not
 * offer. */
export function oauthStartPageData(ctx: PageContext<OauthParams>): OauthStartViewProps {
  const { lang, oauth } = ctx.params
  if (!OAUTH_PROVIDERS.includes(oauth as OauthProvider)) {
    throw new HttpError('NOT_FOUND', { message: `Unknown OAuth2 provider "${oauth}".` })
  }
  return { lang, oauth, csrfToken: ctx.csrfToken }
}

/**
 * The `Set-Cookie` header persisting an OAuth2 `state` under `@zanix/auth`'s own cookie name.
 * `oauthStateVerifyGuard` compares it against the `state` the provider echoes back on the callback
 * leg. `iam` mints `state` itself when asked for an authorization URL, so the cookie must carry
 * whatever `iam` returned, not a separately guard-minted value.
 */
export function buildOauthStateSetCookieHeader(state: string): string {
  return `${OAUTH_STATE_COOKIE_NAME}=${state}; Max-Age=${OAUTH_STATE_MAX_AGE_SECONDS}; ` +
    'Path=/; HttpOnly; Secure; SameSite=Lax'
}

/** The `action` of the OAuth2 start page: asks `iam` for the provider's authorization URL and
 * redirects to it, with the `state` persisted for the callback. */
export async function handleOauthStartAction(
  ctx: PageActionContext<OauthParams>,
  options: { loginClient: LazyClient<LoginClient> },
): Promise<Response> {
  const { url, state } = await client(options.loginClient).oauthAuthorize(
    ctx.params.oauth as OauthProvider,
  )
  return new Response(null, {
    status: 302,
    headers: { Location: url, 'Set-Cookie': buildOauthStateSetCookieHeader(state) },
  })
}

// -- reactivation -------------------------------------------------------------------------------

/** Route params of the reactivation confirmation page (`/{lang}/login/reactivate/{token}`). */
export type ReactivateParams = { lang: string; token: string }

/** The `loader` data of the reactivation page beyond the message catalog and the layout. */
export function reactivatePageData(
  ctx: PageContext<ReactivateParams>,
): { lang: string; csrfToken?: string; expired: boolean } {
  return {
    lang: ctx.params.lang,
    csrfToken: ctx.csrfToken,
    expired: ctx.url.searchParams.get('error') === REACTIVATE_EXPIRED_ERROR,
  }
}

/**
 * The `action` of the reactivation page: confirms the reactivation with the short-lived token the
 * identity check produced, applies the session and lands on `defaultPath` (or the visitor's own
 * `redirect_to`). An invalid or expired token (`403`) redirects back with the expired state; an
 * account that also needs a second factor falls back to a fresh sign-in.
 * @param cacheTokens - Seeds the app's session-refresh cache with the issued pair. Best effort: a
 * failure never blocks the sign-in.
 */
export async function handleReactivateAction(
  ctx: PageActionContext<ReactivateParams>,
  options: {
    loginClient: LazyClient<LoginClient>
    defaultPath: string
    cacheTokens?: (subject: string, tokens: RefreshResult) => Promise<void>
  },
): Promise<Response> {
  const { lang, token } = ctx.params

  let result: Awaited<ReturnType<LoginClient['confirmReactivation']>>
  try {
    result = await client(options.loginClient).confirmReactivation(token)
  } catch (e) {
    if (e instanceof RestClientError && e.realHttpStatus === 403) {
      return redirectResponse(
        `/${lang}/login/reactivate/${token}?error=${REACTIVATE_EXPIRED_ERROR}`,
      )
    }
    throw e
  }

  if (!('accessToken' in result)) return redirectResponse(`/${lang}/login`)

  applySessionTokens(ctx as unknown as ScopedContext, result)
  let subject: string | undefined
  try {
    subject = decodeJWT(result.accessToken).payload.sub as string | undefined
  } catch {
    subject = undefined
  }
  if (subject && options.cacheTokens) {
    try {
      await options.cacheTokens(subject, result)
    } catch {
      // Best effort: a cold cache only costs one extra refresh on the first guarded page.
    }
  }

  return redirectResponse(resolvePostLoginRedirect(ctx.url, options.defaultPath))
}

// -- one-time code: resend ----------------------------------------------------------------------

/** Route params of the OTP resend action (`/{lang}/login/otp/{email}/resend`). */
export type ResendParams = { lang: string; email: string }

/**
 * The `action` of the "send the code again" route. It re-checks the cooldown the code screen
 * already displayed before dispatching anything, so a stale page, a second tab or a replayed
 * request never double-dispatches a code mid-cooldown; a failed dispatch leaves the visitor on the
 * code screen as they were. The chosen channel travels on the redirect (`?channel=`).
 * @param notifier - The channel the visitor picked; `'email'` when the picker never rendered.
 * @param cooldown - Reads and restarts the resend cooldown of an address.
 */
export async function handleOtpResendAction(
  ctx: PageActionContext<ResendParams>,
  options: {
    otpClient: LazyClient<OtpClient>
    notifier: OtpChannel | undefined
    cooldown: {
      endsAt: (email: string) => Promise<number | undefined>
      stamp: (email: string) => Promise<void>
    }
  },
): Promise<Response> {
  const { lang } = ctx.params
  const email = decodeEmailParam(ctx.params.email)
  const destination = `/${lang}/login/otp/${encodeURIComponent(email)}`

  if (await options.cooldown.endsAt(email)) return redirectResponse(destination)

  try {
    await client(options.otpClient).request(email, options.notifier)
  } catch (e) {
    if (e instanceof RestClientError) return redirectResponse(destination)
    throw e
  }

  await options.cooldown.stamp(email)
  return redirectResponse(withOtpChannelParam(destination, options.notifier ?? 'email'))
}

// -- sign out -----------------------------------------------------------------------------------

/**
 * Marks the request's own session revoked so `@zanix/server`'s session interceptor clears the
 * cookies on the way out. Sets the access token's `exp` to `0` as well as the status: the
 * interceptor only emits the clearing `Max-Age=0` batch once the access token's own expiry
 * computes to the past, and a `'revoked'` status that still carries the fresh `exp` a guard just
 * rotated keeps issuing a valid session cookie.
 */
export function markSessionRevoked(ctx: PageActionContext<unknown>): void {
  const current = (ctx.session ?? {}) as Record<string, unknown>
  const payload = (current.payload as Record<string, unknown> | undefined) ?? {}
  ctx.locals.session = { ...current, payload: { ...payload, exp: 0 }, status: 'revoked' }
}
