import { assertEquals } from 'jsr:@std/assert@0.224'
import { defineMiddlewareDecorator } from '@zanix/server'

/**
 * `@zanix/server`'s stacked method decorators apply BOTTOM-UP: the decorator written closest to
 * the method registers, and therefore runs, first. `login.handler.ts`'s `refresh` and
 * `phoneConfirm` depend on it: their identity guards sit below `@RateLimitGuard` so they populate
 * `ctx.locals.session` before the rate limiter reads it.
 *
 * `Guard`/`RateLimitGuard` are both built on `defineMiddlewareDecorator`, so this test pins the
 * mechanism on that primitive. The resulting order on the real `LoginController` routes is
 * asserted in `integration/server/handlers/routes.test.ts`.
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

    // The decorator closer to the method (written second/below) applies, and therefore runs,
    // first. If this flips, `login.handler.ts`'s decorator order needs re-checking.
    assertEquals(applicationOrder, [
      'written second (closer to the method)',
      'written first (topmost)',
    ])
  },
)
