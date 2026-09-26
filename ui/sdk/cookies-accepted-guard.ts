/**
 * @module
 *
 * The global guard an app with no cookie-consent banner registers so that its session cookies are
 * delivered at all.
 */

import type { GuardContext, MiddlewareGuard } from '@zanix/server'
import { GENERAL_HEADERS } from '@zanix/server'
import { markCookiesAccepted } from '@zanix/auth'

/** A year in seconds: the `Max-Age` `@zanix/auth` gives its own long-lived session cookies. */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

/**
 * Marks every request as having accepted cookies, the signal `@zanix/auth` requires before it
 * delivers a session `Set-Cookie` to the browser. For an app whose cookies are all functional (the
 * session itself) and that shows no consent banner to gate them behind.
 *
 * It does both things the signal needs:
 * 1. `markCookiesAccepted(ctx)` adds the header to this same request, because the cookies of a
 *    request are read once, before any app guard runs, so a cookie set by this response cannot help
 *    the request that sets it.
 * 2. It also sets the cookie, for every later request. Its `Max-Age` equals the one `@zanix/auth`
 *    gives its own cookie of the same name: with two `Set-Cookie` lines for one name in a response
 *    the browser keeps the last, so a shorter-lived one here would replace the long-lived one.
 *
 * Register it globally (`defineMiddleware([cookiesAcceptedGuard()])`), not per page: a plain form
 * post only carries what an earlier response already set, wherever the visitor landed first.
 */
export function cookiesAcceptedGuard(): MiddlewareGuard {
  return (ctx: GuardContext) => {
    markCookiesAccepted(ctx)

    return {
      headers: {
        'Set-Cookie':
          `${GENERAL_HEADERS.cookiesAcceptedHeader}=true; Max-Age=${ONE_YEAR_SECONDS}; Path=/; SameSite=Strict`,
      },
    }
  }
}
