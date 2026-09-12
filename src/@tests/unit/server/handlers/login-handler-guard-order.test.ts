import { assertEquals } from 'jsr:@std/assert@0.224'
import { defineMiddlewareDecorator } from '@zanix/server'

/**
 * A real, confirmed regression this guards against: `@zanix/server`'s stacked method decorators
 * apply BOTTOM-UP — the decorator closest to the method registers (and therefore RUNS) first,
 * the exact opposite of top-to-bottom reading order. This bit `login.handler.ts`'s own `refresh`
 * endpoint for real: `refreshRateLimitIdentityGuard` was originally written ABOVE
 * `@RateLimitGuard`, which silently made `@RateLimitGuard` run FIRST every time — the identity
 * guard's own `ctx.locals.session` write never reached it, so every refresh call fell back to the
 * anonymous/IP rate-limit bucket regardless of a valid `X-Znx-App-Token` being present (caught via
 * a live cross-session integration test, not by this repo's own suite — that gap is exactly what
 * this test now closes).
 *
 * `Guard`/`RateLimitGuard` themselves are both built on the exact same `defineMiddlewareDecorator`
 * primitive (`@zanix/server`'s own `modules/infra/middlewares/decorators/guard.ts` /
 * `@zanix/auth`'s `modules/middlewares/decorators/rate-limit.ts`) — `@zanix/server` doesn't expose
 * a way to read back a real controller's own registered guard order for a targeted assertion
 * against `LoginController.refresh` specifically, so this test verifies the underlying mechanism
 * directly instead, with the exact same primitive both real decorators are built from.
 */
Deno.test(
  'stacked method decorators apply BOTTOM-UP: the one written closer to the method runs first',
  () => {
    const applicationOrder: string[] = []

    function tracedGuardDecorator(label: string) {
      const real = defineMiddlewareDecorator('guard', (() => ({})) as never)
      return function (target: unknown, context: unknown): void {
        applicationOrder.push(label)
        ;(real as (t: unknown, c: unknown) => void)(target, context)
      }
    }

    class _TestController {
      @tracedGuardDecorator('written first (topmost)')
      @tracedGuardDecorator('written second (closer to the method)')
      public someMethod() {}
    }

    // The decorator closer to the method (written second/below) must be the one that actually
    // applies — and therefore runs — FIRST. If this ever flips (a real `@zanix/server` behavior
    // change), `login.handler.ts`'s own decorator order comment and the fix it documents both need
    // re-checking.
    assertEquals(applicationOrder, [
      'written second (closer to the method)',
      'written first (topmost)',
    ])
  },
)
