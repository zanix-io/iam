import type { ZanixGenericDecorator } from '@zanix/server'

import { RateLimitGuard } from '@zanix/auth'
import { phoneEnrollRateLimit, phoneEnrollRateLimitWindowSeconds } from './constants.ts'

/**
 * Gives `POST /login/phone/enroll` a rate limit of its own, counted PER ACCOUNT: at most
 * `PHONE_ENROLL_RATELIMIT` requests per `PHONE_ENROLL_RATELIMIT_WINDOW_SECONDS`, in a bucket
 * (`iam:phone-enroll`) no other route shares. Every request sends a paid SMS to a number the caller
 * chooses, so without it any signed-in account could flood a number or run up the SMS bill. It is
 * `@zanix/auth`'s `RateLimitGuard` with an explicit `limit` and `key: 'subject'` (every token of the
 * same account shares the bucket; a new login or refresh does not start a new count).
 *
 * **Write it ABOVE `@AuthTokenValidation`**: stacked decorators run bottom-up, and the limit needs
 * the session the token validation sets.
 */
export function PhoneEnrollRateLimit(): ZanixGenericDecorator {
  return RateLimitGuard({
    app: 'iam:phone-enroll',
    limit: phoneEnrollRateLimit,
    windowSeconds: phoneEnrollRateLimitWindowSeconds,
    key: 'subject',
    anonymousLimit: false,
  })
}
