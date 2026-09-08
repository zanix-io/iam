import type { HandlerContext } from '@zanix/server'

import { defineMiddlewareDecorator } from '@zanix/server'

/**
 * An interceptor runs after the handler has already produced a `Response`, for modifying,
 * wrapping, or observing it (adding headers, logging, unifying the response format). It only runs
 * if the handler successfully returns a `Response` — it never runs if the handler throws.
 *
 * Apply this on a handler method (intercepts just that handler's response) or on a whole class
 * (intercepts every method's response), e.g.:
 * `@ExampleInterceptor public async someHandler(ctx: HandlerContext) { ... }`
 */
export const ExampleInterceptor: ReturnType<typeof defineMiddlewareDecorator> =
  defineMiddlewareDecorator(
    'interceptor',
    (_ctx: HandlerContext, response: Response): Response => {
      // Modify, wrap, or observe the outgoing Response here, e.g.:
      // response.headers.set('X-Custom-Header', 'value')
      return response
    },
  )
