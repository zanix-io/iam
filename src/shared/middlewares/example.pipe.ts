import type { HandlerContext } from '@zanix/server'

import { defineMiddlewareDecorator } from '@zanix/server'

/**
 * A pipe runs before the handler, for validating, sanitizing, or transforming incoming data. It
 * doesn't return a `Response` directly — throw instead to short-circuit the request (the thrown
 * error is later caught and turned into a `Response` by the final interceptor / global error
 * handler).
 *
 * Apply this on a handler method (pipes just that handler) or on a whole class (pipes every method
 * on it), e.g.:
 * `@ExamplePipe public async someHandler(ctx: HandlerContext) { ... }`
 */
export const ExamplePipe: ReturnType<typeof defineMiddlewareDecorator> = defineMiddlewareDecorator(
  'pipe',
  (_ctx: HandlerContext): void => {
    // Validate, sanitize, or transform incoming data here.
  },
)
