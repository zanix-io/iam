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

/** A backup code: 10 characters of the unambiguous alphabet, any case, with spaces and dashes
 * ignored (shown as `XXXXX-XXXXX`). Mirrors `normalizeBackupCode` on the server. */
const BACKUP_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/

/**
 * Validates the code of an account that has an authenticator app, where a backup code is accepted
 * in place of the 6-digit authenticator code (the sign-in challenge and the step-up of such an
 * account).
 *
 * @returns `true` when the code is a well-formed 6-digit string or a well-formed backup code, or a
 * human-readable message to show inline otherwise. A well-formed code can still be rejected
 * server-side (wrong, expired, already used).
 */
export function validateTotpOrBackupCode(code: string): true | string {
  if (!code) return 'Enter your verification code.'
  if (VERIFICATION_CODE_PATTERN.test(code)) return true
  if (BACKUP_CODE_PATTERN.test(code.replace(/[\s-]/g, '').toUpperCase())) return true
  return 'Enter the 6-digit code or a backup code.'
}
