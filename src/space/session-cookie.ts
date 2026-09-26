import { SESSION_HEADERS } from '@zanix/server'

/**
 * Synchronous, presence-only check for this project's own session cookie
 * (`SESSION_HEADERS.user.token`, `X-Znx-App-Token`) — no JWT verification, just "is the cookie
 * there at all". Exists for `SpacePageController`'s own static `redirect.condition`, which
 * `handleGet` calls synchronously (no `await`) BEFORE `loader`/`component` ever run — see
 * `login/page.tsx`'s own already-authenticated bounce-away.
 *
 * Deliberately local rather than in `@zanix/auth`: this two-line, presence-only check has exactly
 * one consumer type (a `@zanix/space` page's own static redirect condition) and no
 * security-hardening angle of its own.
 *
 * Never a substitute for a real guard: a present-but-invalid/expired/tampered cookie still passes
 * this check — `pageSessionGuard`/`AuthTokenValidation` are the only real enforcement points on any
 * page/endpoint that actually needs one.
 *
 * A plain split-on-`;` prefix scan over the `Cookie` header, not a real cookie parser
 * (`@std/http/cookie`'s `getCookies`) — deliberately, so this project takes on no new dependency
 * for a presence-only check with no need for value decoding. Safe for a presence check: a cookie
 * NAME can't legally contain `=`/`;` (RFC 6265 `cookie-name` is a `token`), so a pair starting with
 * `<name>=` is always that cookie itself.
 *
 * @param request - The raw incoming request — `PageContext.request`.
 * @returns Whether the request's own `Cookie` header carries the session-refresh-token cookie.
 */
export function hasSessionCookie(request: Request): boolean {
  const header = request.headers.get('cookie')
  if (!header) return false

  const name = SESSION_HEADERS.user.token as string
  return header.split(';').some((pair) => pair.trim().startsWith(`${name}=`))
}
