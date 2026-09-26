/**
 * @module
 *
 * Small reads of the session that every `@zanix/space` app behind `iamSessionGuard` needs in its
 * pages: the access token to forward to a service, the caller's own user id, and a cheap check for
 * whether a session cookie exists at all. Nothing here knows an app's routes, scopes or services.
 */

import { getCookies } from 'jsr:@std/http@0.224/cookie'
import { SESSION_HEADERS } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import type { PageActionContext, PageContext } from '@zanix/space'

/**
 * The current request's session access token, from `ctx.session` (which the session guard
 * populates), as a plain string to pass explicitly to whichever service a page talks to.
 * @throws {HttpError} `UNAUTHORIZED` when there is no access token: the route was reached without
 * the session guard, since every request that passed it has one.
 */
export function requireAccessToken(ctx: PageContext | PageActionContext): string {
  const accessToken = ctx.session?.accessToken as string | undefined
  if (!accessToken) {
    throw new HttpError('UNAUTHORIZED', { message: 'No authenticated session access token.' })
  }
  return accessToken
}

/**
 * The caller's own user id, `ctx.session.subject` (the JWT's `sub` claim). `ctx.session.id` is a
 * different field, the token's `jti`, which rotates on every refresh and never identifies a user.
 * @throws {Error} When there is no session subject. The session guard rejects such a request before
 * a `loader` or `action` runs, so this only fires on a misconfigured route.
 */
export function requireOwnUserId<Params>(
  ctx: PageContext<Params> | PageActionContext<Params>,
): string {
  const ownUserId = ctx.session?.subject
  if (!ownUserId) {
    throw new Error(
      'No authenticated session subject — the session guard should have rejected this already.',
    )
  }
  return ownUserId
}

/**
 * Whether the request carries the session refresh-token cookie. For a page that stays public but
 * varies what it shows a probably signed-in visitor (hiding a "sign in" link, say) without gating
 * the page behind the session guard.
 *
 * It is a presence check, never a validity one: it never calls `iam`'s rate-limited refresh, and
 * an expired or revoked cookie still reads as present. Use the session guard wherever the answer
 * has to be enforced. It reads the raw `Cookie` header of `request`, which carries the cookie
 * whether or not any guard or pipe has run.
 */
export function hasSessionCookie(request: Request): boolean {
  return Boolean(getCookies(request.headers)[SESSION_HEADERS.user.token as string])
}
