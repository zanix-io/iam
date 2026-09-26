import { getRequestFromError } from '@zanix/server'

/**
 * Why {@link iamSessionGuard} rejected the visit — the same distinction its own `code` discriminator
 * carries (`'NO_SESSION_COOKIE'`/`'SESSION_REFRESH_FAILED'`, see that guard's own doc), surfaced
 * here as a semantic value so a consuming app's own `loginUrl` callback never needs to know that
 * guard's internal `HttpError.code` string literals directly.
 *
 * - `'no-session'` — no refresh-token cookie was presented AT ALL. A visitor who was never logged
 *   in on this browser (a fresh visit, a cleared cookie jar, a private window) — never a session
 *   that "expired."
 * - `'session-expired'` — a cookie WAS presented, but the real `zanix/iam` refresh call rejected it
 *   (expired, invalid, or revoked).
 */
export type IamUnauthorizedReason = 'no-session' | 'session-expired'

/**
 * An `OnErrorHandler`-shaped recovery function — the real, matched redirect-handling counterpart
 * to {@link iamSessionGuard}, owned by this SDK for the same reason that guard is (see its own
 * module doc). `@zanix/auth`'s own `redirectUnauthenticatedPageVisit` is the wrong tool here for
 * two reasons:
 *
 * 1. **A cross-package `HttpError` identity split.** `redirectUnauthenticatedPageVisit` checks
 *    `error instanceof HttpError` against `@zanix/auth`'s OWN `@zanix/errors` import — correct only
 *    when the guard that threw is ALSO `@zanix/auth`'s own `pageSessionGuard`. `iamSessionGuard`
 *    throws its OWN `HttpError` from its OWN `@zanix/errors` import instead (this SDK deliberately
 *    does not depend on `@zanix/auth` — see this guard's own module doc), which `zanix space dev`'s
 *    dev-mode SSR bundler has no structural guarantee collapses to the SAME class reference as
 *    `@zanix/auth`'s own copy, so a class check can miss the error and leave the raw JSON `401`
 *    body as the response. This handler checks the error's shape structurally
 *    (`name === 'HttpError'` and `status.value === 401`) instead — true regardless of which copy of
 *    `@zanix/errors` produced it.
 * 2. **`redirectUnauthenticatedPageVisit` has no concept of {@link IamUnauthorizedReason} at all.**
 *    It redirects unconditionally for any `401`, with no way to tell a genuinely NEW visitor apart
 *    from one whose real session expired, so a login page can't avoid showing "your session
 *    expired" to a first-time visitor. This handler passes the real reason
 *    through to `options.loginUrl` instead, so the caller's own login page can render (or not
 *    render) whatever messaging fits — this SDK has no opinion on that app's own copy/URL
 *    conventions, only on correctly detecting and surfacing WHICH case occurred.
 */
export function redirectIamUnauthorized(
  options: { loginUrl: (request: Request, reason: IamUnauthorizedReason) => string | URL },
): (error: unknown) => Response | undefined {
  return (error: unknown) => {
    if (typeof error !== 'object' || error === null) return undefined
    const shape = error as { name?: unknown; status?: { value?: unknown }; code?: unknown }
    if (shape.name !== 'HttpError' || shape.status?.value !== 401) return undefined

    const request = getRequestFromError(error)
    if (!request) return undefined

    const reason: IamUnauthorizedReason = shape.code === 'NO_SESSION_COOKIE'
      ? 'no-session'
      : 'session-expired'
    const location = options.loginUrl(request, reason)
    return new Response(null, { status: 302, headers: { location: String(location) } })
  }
}
