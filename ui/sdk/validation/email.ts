import { isEmail } from '@zanix/validator'

/**
 * Validates an email address before submitting a login/OTP/password-recovery form — reuses
 * `@zanix/validator`'s own `isEmail` predicate (the exact same regex `iam`'s server-side
 * `@IsEmail()` decorator validates against), so client-side and server-side email validation never
 * drift apart.
 *
 * @returns `true` when valid, or a human-readable message to show inline otherwise.
 */
export function validateEmail(email: string): true | string {
  if (!email) return 'Email is required.'
  if (!isEmail(email)) return 'Enter a valid email address.'
  return true
}
