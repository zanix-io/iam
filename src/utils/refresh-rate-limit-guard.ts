import type { GuardContext, GuardResponse } from '@zanix/server'

import { SESSION_HEADERS } from '@zanix/server'
import { decodeJWT } from '@zanix/auth'
import { criticalRateLimit } from './constants.ts'

/**
 * @module
 *
 * Gives `POST /login/refresh` a per-identity rate-limit bucket, which a plain
 * `@RateLimitGuard({ anonymousLimit, trustProxyHeader: true })` can't do on its own: `@zanix/auth`'s `rateLimitGuard` keys its bucket by
 * `ctx.locals.session` when one already exists, falling back to the resolved client IP only when
 * it doesn't — but guards run BEFORE the request body is validated (`@zanix/server`'s own
 * `routerGuard` → `routerPipe` order — `requestValidationPipe` is a PIPE, not a guard), so a guard
 * can never read `ctx.payload.body.token` in time to populate a real, identity-keyed session for
 * `rateLimitGuard` to use. Without this guard, every caller presenting a refresh token in the BODY
 * (the shape `TokenRTO`/this project's own SDK client use) shares the single anonymous/IP bucket —
 * harmless for an end user's own browser (distinct IPs), but a problem for a consumer proxying these calls through its own backend on behalf of many different end users
 * (a normal SSR/BFF pattern): every one of THEIR users collapses onto the consumer backend's own
 * IP, sharing one bucket.
 *
 * This guard does NOT trust any
 * caller-supplied "this is the real client IP" header (which would itself be a spoofable
 * rate-limit-bypass hole) — it reuses `rateLimitGuard`'s EXISTING session-based path by reading
 * the refresh token from somewhere a guard genuinely CAN see pre-body: the `SESSION_HEADERS.user
 * .token` (`X-Znx-App-Token`) request HEADER (for a server-to-server caller sending it explicitly,
 * the same header name this ecosystem already uses for the equivalent COOKIE) or that same-named
 * COOKIE (for a same-site browser request). Either way, the identity comes from a token the
 * caller must already legitimately hold to do anything useful with it — not from an
 * arbitrary, spoofable claim.
 *
 * Decoding here is UNVERIFIED (`decodeJWT`, not `verifyJWT`) — safe because it's used ONLY to pick
 * a rate-limit bucket key (see `AuthService.decodeRefreshSubject`'s own doc); signature
 * verification still happens later, in `session.refreshTokens()` itself. A forged/garbage token
 * just fails to decode and falls through to the anonymous/IP bucket — this guard only ever ADDS
 * precision, never removes that safety net.
 */

/**
 * Populates `ctx.locals.session` from the refresh token's own (unverified) `sub` claim, read from
 * a header or cookie — see this module's own doc for the full reasoning. Place this guard BEFORE
 * `@RateLimitGuard` on the same route so the latter's session-based keying (not its anonymous/IP
 * fallback) applies whenever the token is present and decodable.
 */
export function refreshRateLimitIdentityGuard(): (ctx: GuardContext) => GuardResponse {
  const tokenKey = SESSION_HEADERS.user.token as string

  return (ctx) => {
    const raw = ctx.req.headers.get(tokenKey) || ctx.cookies[tokenKey]
    if (raw) {
      try {
        const sub = decodeJWT(raw).payload.sub as string | undefined
        if (sub) ctx.locals.session = { id: sub, type: 'user', rateLimit: criticalRateLimit }
      } catch {
        // Undecodable — leave `ctx.locals.session` unset; `rateLimitGuard` falls back to its own
        // anonymous/IP path.
      }
    }
    return {}
  }
}
