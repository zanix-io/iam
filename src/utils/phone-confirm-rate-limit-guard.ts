import type { GuardContext, GuardResponse } from '@zanix/server'

import { freeRateLimit } from './constants.ts'

/**
 * Enforces `freeRateLimit` on `login.handler.ts`'s own `phoneConfirm` route, which a plain
 * `@RateLimitGuard({ anonymousLimit: freeRateLimit, ... })` alone can't do: `@zanix/auth`'s own
 * `rateLimitGuard` only ever falls back to `anonymousLimit` when `ctx.locals.session` has NO
 * `.rateLimit` field of its own — but `@AuthTokenValidation()` (this route's own auth guard)
 * populates `ctx.locals.session.rateLimit` FROM THE CALLER'S OWN ACCESS TOKEN (`defineLocalSession`,
 * `@zanix/auth`), a generic, account-tier-wide API rate limit that has nothing to do with "wrong
 * guesses at a 6-digit SMS code" and is typically far looser than `freeRateLimit` (3). `anonymousLimit`
 * only ever applies to a caller with NO session, which never happens on an `@AuthTokenValidation()`-
 * protected route, so without this guard the intended 3-attempt ceiling never applies.
 *
 * Sibling of `refresh-rate-limit-guard.ts` (a route needing a `rateLimit` value `@RateLimitGuard`
 * alone can't express) — but here the problem is the wrong LIMIT applying, not the wrong IDENTITY.
 * Overwrites `ctx.locals.session` with a fresh object carrying `rateLimit: freeRateLimit`
 * — a plain reassignment, never a mutation of the existing (already `Object.freeze`d, by
 * `jwtValidationGuard`) session object, which would throw.
 *
 * Place this guard BEFORE `@RateLimitGuard` on the same route (closer to the method — decorators
 * apply bottom-up) so the latter reads THIS
 * `rateLimit`, never the caller's own token-derived one.
 */
export function phoneConfirmRateLimitIdentityGuard(): (ctx: GuardContext) => GuardResponse {
  return (ctx) => {
    const subject = ctx.locals.session?.subject as string | undefined
    if (subject) {
      ctx.locals.session = { id: subject, type: 'user', rateLimit: freeRateLimit }
    }
    return {}
  }
}
