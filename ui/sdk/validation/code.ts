/** Both `iam`'s OTP and TOTP codes are 6-digit numeric strings (`@zanix/auth`'s own OTP/TOTP
 * defaults), so one shared shape validates either. */
const VERIFICATION_CODE_PATTERN = /^\d{6}$/

/**
 * Validates a 6-digit OTP or authenticator-app (TOTP) verification code before submitting it to
 * `iam`'s login/enrollment endpoints — both codes share the identical shape, so this one function
 * validates either.
 *
 * @returns `true` when the code is a well-formed 6-digit string, or a human-readable message to
 * show inline otherwise. A well-formed code can still be rejected server-side (wrong/expired) —
 * this only catches a malformed submission before it's sent.
 */
export function validateVerificationCode(code: string): true | string {
  if (!code) return 'Enter your verification code.'
  if (!VERIFICATION_CODE_PATTERN.test(code)) return 'Enter the 6-digit code.'
  return true
}
