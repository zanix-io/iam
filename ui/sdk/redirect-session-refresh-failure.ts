import { getRequestFromError, RestClientError } from '@zanix/server'
import { buildRateLimitedQuery, REDIRECT_TO_PARAM, UNEXPECTED_ERROR } from './login-flow.ts'

/** Options for {@linkcode redirectSessionRefreshFailure}. */
export type RedirectSessionRefreshFailureOptions = {
  /** The language segment used when the request path has none. */
  defaultLang: string
  /** The app's own login page for `lang`. @default `/${lang}/login` */
  loginPath?: (lang: string) => string
}

/**
 * An `OnErrorHandler`-shaped recovery function that turns the one refresh failure
 * {@link iamSessionGuard} deliberately does not collapse into a plain `401` — a `RestClientError`
 * from `iam`'s session refresh (a `429`, or any other upstream fault) reaching the error chain
 * unchanged — into a redirect to the app's own login page, instead of a raw JSON body on what a
 * browser expects to be an HTML page.
 *
 * A `429` maps to the rate-limited state (with its live `retryUntil`), anything else to the
 * generic unexpected-error state; `redirect_to` carries the page that was being visited. Nothing
 * here clears the caller's session cookies: a reload once the window clears succeeds on its own.
 *
 * Declines (`undefined`) for anything that is not a `RestClientError`, or that arrives with no
 * request attached (`server.ssr.attachRequestToErrors: true` is required), so it composes safely
 * with the other handlers of a `globalErrorHandler` chain in any order.
 */
export function redirectSessionRefreshFailure(
  options: RedirectSessionRefreshFailureOptions,
): (error: unknown) => Response | undefined {
  const loginPath = options.loginPath ?? ((lang: string) => `/${lang}/login`)
  return (error: unknown) => {
    if (!(error instanceof RestClientError)) return undefined
    const request = getRequestFromError(error)
    if (!request) return undefined

    const url = new URL(request.url)
    const lang = url.pathname.split('/')[1] || options.defaultLang
    const errorQuery = error.realHttpStatus === 429
      ? buildRateLimitedQuery(error)
      : `error=${UNEXPECTED_ERROR}`
    const destination = encodeURIComponent(`${url.pathname}${url.search}`)
    const location = `${loginPath(lang)}?${errorQuery}&${REDIRECT_TO_PARAM}=${destination}`

    return new Response(null, { status: 302, headers: { location } })
  }
}
