import type { ZanixGenericDecorator } from '@zanix/server'

import { RateLimitGuard } from '@zanix/auth'
import {
  adminLookupRateLimit,
  adminLookupRateLimitWindowSeconds,
  adminMutationRateLimit,
  adminMutationRateLimitWindowSeconds,
} from './constants.ts'

/**
 * The per-operator limit both administration limits are made of: `limit` requests per
 * `windowSeconds` in the bucket `app`, shared by every route that carries it. It is `@zanix/auth`'s
 * `RateLimitGuard` with an explicit `limit` (never read as a `RATE_LIMIT_PLANS` index, and the one
 * the `X-Znx-RateLimit-*` headers report) and `key: 'subject'` (every token of the same account
 * shares the bucket; a new login or refresh does not start a new count).
 */
function perOperatorLimit(app: string, limit: number, windowSeconds: number) {
  return RateLimitGuard({ app, limit, windowSeconds, key: 'subject', anonymousLimit: false })
}

/**
 * Gives the administration mutations a rate limit of their own, counted PER OPERATOR: at most
 * `ADMIN_MUTATION_RATELIMIT` requests per `ADMIN_MUTATION_RATELIMIT_WINDOW_SECONDS`, in one bucket
 * (`iam:admin-mutations`) shared by every route that carries it.
 *
 * **Write it ABOVE `@AuthTokenValidation`**: stacked decorators run bottom-up, and the limit needs
 * the session the token validation sets.
 */
export function AdminMutationRateLimit(): ZanixGenericDecorator {
  return perOperatorLimit(
    'iam:admin-mutations',
    adminMutationRateLimit,
    adminMutationRateLimitWindowSeconds,
  )
}

/**
 * Gives the exact account lookup by email a stricter limit of its own, counted PER OPERATOR: at most
 * `ADMIN_LOOKUP_RATELIMIT` requests per `ADMIN_LOOKUP_RATELIMIT_WINDOW_SECONDS`, in one bucket
 * (`iam:admin-lookups`) that no other route shares. It slows down testing a list of addresses.
 * Same placement as {@linkcode AdminMutationRateLimit}: ABOVE `@AuthTokenValidation`.
 */
export function AdminLookupRateLimit(): ZanixGenericDecorator {
  return perOperatorLimit(
    'iam:admin-lookups',
    adminLookupRateLimit,
    adminLookupRateLimitWindowSeconds,
  )
}
