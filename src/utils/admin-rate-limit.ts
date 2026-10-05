import type { ZanixGenericDecorator } from '@zanix/server'

import { RateLimitGuard } from '@zanix/auth'
import { adminMutationRateLimit, adminMutationRateLimitWindowSeconds } from './constants.ts'

/**
 * Gives the administration mutations a rate limit of their own, counted PER OPERATOR: at most
 * `ADMIN_MUTATION_RATELIMIT` requests per `ADMIN_MUTATION_RATELIMIT_WINDOW_SECONDS`, in one bucket
 * (`iam:admin-mutations`) shared by every route that carries it. It is `@zanix/auth`'s
 * `RateLimitGuard` with an explicit `limit` (never read as a `RATE_LIMIT_PLANS` index, and the one
 * the `X-Znx-RateLimit-*` headers report) and `key: 'subject'` (every token of the same account
 * shares the bucket; a new login or refresh does not start a new count).
 *
 * **Write it ABOVE `@AuthTokenValidation`**: stacked decorators run bottom-up, and the limit needs
 * the session the token validation sets.
 */
export function AdminMutationRateLimit(): ZanixGenericDecorator {
  return RateLimitGuard({
    app: 'iam:admin-mutations',
    limit: adminMutationRateLimit,
    windowSeconds: adminMutationRateLimitWindowSeconds,
    key: 'subject',
    anonymousLimit: false,
  })
}
