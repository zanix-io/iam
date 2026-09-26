import { assertEquals } from 'jsr:@std/assert@0.224'
import type { GuardContext } from '@zanix/server'
import { freeRateLimit } from 'utils/constants.ts'
import { phoneConfirmRateLimitIdentityGuard } from 'utils/phone-confirm-rate-limit-guard.ts'

function buildCtx(session: unknown): GuardContext {
  return { id: 'req-1', req: { headers: { get: () => null } }, locals: { session } } as never
}

/**
 * `@AuthTokenValidation()` populates `ctx.locals.session.rateLimit` from the caller's access token,
 * a generic account-tier limit unrelated to this route's 3-attempt ceiling, and
 * `@RateLimitGuard`'s `anonymousLimit` only applies to a session-less caller. This guard replaces
 * the authenticated session's `rateLimit` with the route's own value so the ceiling applies; see
 * `phone-confirm-rate-limit-guard.ts`. The resulting behavior on the real route is asserted in
 * `integration/server/handlers/routes.test.ts`.
 */
Deno.test(
  "phoneConfirmRateLimitIdentityGuard: overwrites an authenticated session with THIS route's own rateLimit (3), never the token's own value",
  () => {
    const ctx = buildCtx({
      id: 'jti-1',
      type: 'user',
      // The token's own generic, much looser account-tier limit — must NOT survive.
      rateLimit: 1000,
      subject: 'user-42',
      payload: {},
    })

    phoneConfirmRateLimitIdentityGuard()(ctx)

    assertEquals(ctx.locals.session, { id: 'user-42', type: 'user', rateLimit: freeRateLimit })
    assertEquals(freeRateLimit, 3)
  },
)

Deno.test(
  'phoneConfirmRateLimitIdentityGuard: a session with no subject is left untouched — never fabricates an identity',
  () => {
    const original = { id: 'jti-1', type: 'user' as const, rateLimit: 1000, payload: {} }
    const ctx = buildCtx(original)

    phoneConfirmRateLimitIdentityGuard()(ctx)

    assertEquals(ctx.locals.session, original)
  },
)

Deno.test(
  'phoneConfirmRateLimitIdentityGuard: no session at all is left untouched — never throws',
  () => {
    const ctx = buildCtx(undefined)

    phoneConfirmRateLimitIdentityGuard()(ctx)

    assertEquals(ctx.locals.session, undefined)
  },
)
