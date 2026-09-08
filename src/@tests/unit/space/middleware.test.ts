import { assertEquals, assertFalse } from 'jsr:@std/assert@0.224'
import { GENERAL_HEADERS } from '@zanix/server'
import type { GuardContext } from '@zanix/server'

import { cookieConsentBypassGuard } from 'space/middleware.ts'
import { COOKIE_CONSENT_ENABLED_ENV } from 'utils/constants.ts'

/**
 * `cookieConsentBypassGuard`'s own logic in isolation — this file's counterpart
 * `integration/space/middleware.test.ts` covers `space/middleware.ts`'s real wiring (the
 * `preHandler` reachable via `getUserPreHandler()`) AND a real `Deno.serve` round trip proving the
 * guard survives a genuinely immutable-`Headers` `Request`; this one is a plain function call with
 * no external system involved (`zanix-test-tier-conventions`' own Pattern C), so it belongs in
 * `unit/`, even though it lives in a file whose top-level import triggers that same wiring as a
 * side effect.
 */

const HEADER = GENERAL_HEADERS.cookiesAcceptedHeader

/**
 * A minimal `GuardContext` — `ctx.cookies` is built `Object.freeze`'d, matching what
 * `@zanix/server`'s own built-in `cookiesGuard` (run before every app guard) actually hands
 * downstream, so a regression back to writing `ctx.cookies` (this guard's own former, real, broken
 * implementation — see its doc) throws here too, not just against a real server round trip.
 * `ctx.req` stays a bare `new Request(...)` — its `Headers` guard is mutable (`"request"`), which
 * is fine here: the immutable-`Headers` case a real incoming request carries is covered by
 * `integration/space/middleware.test.ts`'s own real `Deno.serve` regression test; this file only
 * needs to prove the guard's OWN read/write logic, not the platform constraint around it.
 */
function buildGuardContext(): GuardContext {
  return {
    req: new Request('http://localhost/en/login'),
    cookies: Object.freeze({}),
  } as unknown as GuardContext
}

function withCookieConsentEnv(value: string | undefined, run: () => void) {
  const original = Deno.env.get(COOKIE_CONSENT_ENABLED_ENV)
  if (value === undefined) Deno.env.delete(COOKIE_CONSENT_ENABLED_ENV)
  else Deno.env.set(COOKIE_CONSENT_ENABLED_ENV, value)
  try {
    run()
  } finally {
    if (original === undefined) Deno.env.delete(COOKIE_CONSENT_ENABLED_ENV)
    else Deno.env.set(COOKIE_CONSENT_ENABLED_ENV, original)
  }
}

Deno.test(
  'cookieConsentBypassGuard: injects the accepted header (on a fresh ctx.req, never ctx.cookies) ' +
    'when cookie consent is disabled',
  () => {
    withCookieConsentEnv('false', () => {
      const ctx = buildGuardContext()
      const originalReq = ctx.req
      cookieConsentBypassGuard()(ctx)
      assertEquals(ctx.req.headers.get(HEADER), 'true')
      // The frozen ctx.cookies object is never touched — the fix reassigns ctx.req instead.
      assertEquals(ctx.cookies[HEADER], undefined)
      // ctx.req is a genuinely NEW Request (the original's Headers guard stays untouched), not a
      // mutation of the one the pipeline started with.
      assertFalse(ctx.req === originalReq)
    })
  },
)

Deno.test(
  'cookieConsentBypassGuard: leaves the request untouched while cookie consent stays enabled ' +
    '(default, nothing configured)',
  () => {
    withCookieConsentEnv(undefined, () => {
      const ctx = buildGuardContext()
      const originalReq = ctx.req
      cookieConsentBypassGuard()(ctx)
      assertEquals(ctx.req.headers.get(HEADER), null)
      assertEquals(ctx.req, originalReq)
    })
  },
)

Deno.test(
  'cookieConsentBypassGuard: never overrides an already-recorded decision the client itself sent',
  () => {
    // Cookie consent stays enabled (default) — a real client that already recorded a Decline
    // (`X-Znx-Cookies-Accepted: false`) must not be silently overridden into an Accept.
    withCookieConsentEnv(undefined, () => {
      const ctx = {
        req: new Request('http://localhost/en/login', { headers: { [HEADER]: 'false' } }),
        cookies: Object.freeze({}),
      } as unknown as GuardContext
      cookieConsentBypassGuard()(ctx)
      assertEquals(ctx.req.headers.get(HEADER), 'false')
    })
  },
)
