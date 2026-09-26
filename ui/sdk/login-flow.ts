/**
 * @module
 *
 * The small, framework-free helpers every app that renders `iam`'s login views itself needs around
 * them — the `./sdk/login-flow` subpath. Nothing here knows an app's routes, language list,
 * branding or landing page: each helper takes the values that differ per app as an argument, so a
 * consumer configures it and never forks it.
 */

import type { IamUnauthorizedReason } from './redirect-unauthorized.ts'

/** Query param a caller-chosen post-login destination arrives on: `/{lang}/login?redirect_to=/path`.
 * The same name `iam`'s own hosted pages use for the identical concept. */
export const REDIRECT_TO_PARAM = 'redirect_to'

/** Query param a login screen reads a rate-limit expiry back off of. See
 * {@linkcode buildRateLimitedQuery}. */
export const RETRY_UNTIL_PARAM = 'retryUntil'

/** `error` value: no account exists for the identifier and self-registration is disabled. */
export const NO_ACCOUNT_ERROR = 'no_account'

/** `error` value: the upstream answered `429 Too Many Requests`. */
export const RATE_LIMITED_ERROR = 'rate_limited'

/** `error` value: any other upstream failure — unreachable, a `5xx`, anything that is neither
 * {@linkcode NO_ACCOUNT_ERROR} nor {@linkcode RATE_LIMITED_ERROR}. */
export const UNEXPECTED_ERROR = 'unexpected_error'

/** `error` value: a guarded page was visited with no session cookie at all — a visitor who was
 * never signed in on this browser, never one whose session expired. */
export const NO_SESSION_ERROR = 'no_session'

/** `error` value: the second-factor code was rejected. */
export const INVALID_CODE_ERROR = 'invalid_code'

/**
 * Decodes an `[email]` route segment defensively: an address can carry `+` and `%`, and a
 * malformed percent-sequence degrades to the raw value instead of throwing.
 */
export function decodeEmailParam(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** A same-origin absolute path only. A protocol-relative value (`//host`) is followed by every
 * browser as an absolute URL, so it is rejected together with anything that is not a path. */
function isSafeRedirectPath(value: string | null): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
}

/**
 * Where a successful login, second-factor check or password recovery lands for this request: the
 * request's own `redirect_to` when it is a safe same-origin path, else `defaultPath`.
 * @param defaultPath - The landing page when no safe `redirect_to` was given; each app's own
 * choice (`/es/home`, `/dashboard`, ...).
 */
export function resolvePostLoginRedirect(url: URL, defaultPath: string): string {
  const requested = url.searchParams.get(REDIRECT_TO_PARAM)
  return isSafeRedirectPath(requested) ? requested : defaultPath
}

/**
 * Appends the request's own `redirect_to` (when it is a safe same-origin path) onto `path`, so a
 * destination survives the extra hop through a second-factor challenge. A no-op when the request
 * carries none.
 */
export function withRedirectToParam(path: string, url: URL): string {
  const requested = url.searchParams.get(REDIRECT_TO_PARAM)
  if (!isSafeRedirectPath(requested)) return path
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}${REDIRECT_TO_PARAM}=${encodeURIComponent(requested)}`
}

/**
 * The `error=rate_limited[&retryUntil=…]` query fragment a page redirects back with after an
 * upstream `429`. `retryUntil` is an absolute epoch-ms instant computed once, here, from the
 * error's `retryAfterSeconds` (read as a plain property so an older `RestClientError` without the
 * getter degrades to the fragment with no countdown), so it stays accurate through the redirect.
 */
export function buildRateLimitedQuery(error: unknown): string {
  const retryAfterSeconds = (error as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds
  return typeof retryAfterSeconds === 'number'
    ? `error=${RATE_LIMITED_ERROR}&${RETRY_UNTIL_PARAM}=${Date.now() + retryAfterSeconds * 1000}`
    : `error=${RATE_LIMITED_ERROR}`
}

/** The other half of {@linkcode buildRateLimitedQuery}: the `retryUntil` epoch-ms off a request,
 * `undefined` (never `NaN`) when it is missing or not a number. */
export function parseRetryUntil(url: URL): number | undefined {
  const raw = url.searchParams.get(RETRY_UNTIL_PARAM)
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

/** How a login screen's own `error` query param reads, for the states every screen shares. */
export type LoginErrorState = {
  /** `error=rate_limited` — the rate-limit state, with its own `retryUntil` read by
   * {@linkcode parseRetryUntil}. */
  rateLimited: boolean
  /** `error=unexpected_error`. */
  unexpectedError: boolean
}

/** Reads the shared error states off a request's `error` query param. */
export function readLoginErrorState(url: URL): LoginErrorState {
  const error = url.searchParams.get('error')
  return {
    rateLimited: error === RATE_LIMITED_ERROR,
    unexpectedError: error === UNEXPECTED_ERROR,
  }
}

/**
 * A redirect `Response` a page's `action` can safely return — never `Response.redirect()`, whose
 * headers are immutable by the Fetch spec: `@zanix/server` appends a rotated session `Set-Cookie`
 * (and any other guard-produced header) onto whatever an `action` returns, and doing so on
 * `Response.redirect()` throws `TypeError: Cannot change headers: headers are immutable`.
 */
export function redirectResponse(url: URL | string, status = 303): Response {
  return new Response(null, { status, headers: { Location: String(url) } })
}

/**
 * The `loginUrl` callback of `redirectIamUnauthorized`: the app's own login page, carrying the page
 * that was being visited as `redirect_to`. A visitor with no session at all also gets
 * `error=no_session`, so the login page can tell a first visit apart from an expired session.
 * @param options.defaultLang - The language segment used when the request path has none.
 * @param options.loginPath - The app's own login page for `lang`. @default `/${lang}/login`
 */
export function unauthorizedLoginUrl(
  options: { defaultLang: string; loginPath?: (lang: string) => string },
): (request: Request, reason: IamUnauthorizedReason) => string {
  const loginPath = options.loginPath ?? ((lang: string) => `/${lang}/login`)
  return (request, reason) => {
    const url = new URL(request.url)
    const lang = url.pathname.split('/')[1] || options.defaultLang
    const destination = encodeURIComponent(`${url.pathname}${url.search}`)
    const base = `${loginPath(lang)}?${REDIRECT_TO_PARAM}=${destination}`
    return reason === 'no-session' ? `${base}&error=${NO_SESSION_ERROR}` : base
  }
}
