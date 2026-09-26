/**
 * @module
 *
 * The `ssr.onError` chain of an app that signs in through `iam`, assembled once. Each app wired the
 * same five handlers in the same order by hand, and the order matters: a rotated session cookie has
 * to be recovered before anything redirects, and a missing session, a failed refresh and a stale
 * CSRF token each need their own redirect before the not-found response takes what is left.
 */

import { recoverRotatedSessionCookie } from '@zanix/auth'
import { createNotFoundHandler, globalErrorHandler, redirectCsrfFailure } from '@zanix/space'
import type { ComposableErrorHandler, OnErrorHandler } from '@zanix/space'
import { unauthorizedLoginUrl } from './login-flow.ts'
import { redirectIamUnauthorized } from './redirect-unauthorized.ts'
import { redirectSessionRefreshFailure } from './redirect-session-refresh-failure.ts'

/**
 * The error handler for `bootstrapServers({ ssr: { onError } })`, in this order:
 * 1. recover a session cookie that a guard rotated before it failed;
 * 2. the app's own `before` handlers, for an error only it can place (a role that gates one area);
 * 3. a request without a session, or with an expired one, goes to the login page with
 *    `redirect_to`;
 * 4. a refresh that `iam` failed or rate-limited goes to the login page with that state;
 * 5. a stale or missing CSRF token goes back to the same page as a fresh `GET`;
 * 6. anything else that is a `404` gets the app's not-found page.
 *
 * The app also sets `attachRequestToErrors: true`, which the redirects read the request through.
 * @param options.defaultLang - The language segment used when the request path has none.
 * @param options.loginPath - The app's own login page for `lang`. @default `/${lang}/login`
 * @param options.before - Handlers that run after the cookie recovery and before the redirects.
 */
export function iamErrorHandler(
  options: {
    defaultLang: string
    loginPath?: (lang: string) => string
    before?: ComposableErrorHandler[]
  },
): OnErrorHandler {
  const { defaultLang, loginPath, before = [] } = options
  return globalErrorHandler(
    recoverRotatedSessionCookie(),
    ...before,
    redirectIamUnauthorized({ loginUrl: unauthorizedLoginUrl({ defaultLang, loginPath }) }),
    redirectSessionRefreshFailure({ defaultLang, loginPath }),
    redirectCsrfFailure(),
    createNotFoundHandler(),
  )
}
