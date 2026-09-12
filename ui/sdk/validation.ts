/**
 * @module
 *
 * Client-side form validation for a login/2FA/password-recovery UI — the `./sdk/validation`
 * subpath. Plain functions, no framework/decorator dependency: each mirrors a real server-side
 * rule so a consumer's UI can show an inline error before ever submitting, without duplicating
 * `iam`'s own validation logic incorrectly.
 */
export { validateEmail } from './validation/email.ts'
export { validatePassword } from './validation/password.ts'
export { validateVerificationCode } from './validation/code.ts'
