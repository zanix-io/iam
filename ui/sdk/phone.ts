/**
 * @module
 *
 * Everything a consumer needs to verify a phone number and choose its own login-OTP delivery
 * channel — the `./sdk/phone` subpath. See `./sdk/otp` for the out-of-band login-code sibling and
 * `./sdk/totp` for the authenticator-app one; this manages the phone `PasswordService.recovery`
 * dispatches an out-of-band code TO when the caller prefers `'sms'`/`'whatsapp'` over `'email'`.
 */
export { PhoneClient } from './client/phone.client.ts'
export {
  /** The shared base class every `iam` REST client extends — see its own doc. */
  IamApiClient,
} from './client/base.ts'
export type {
  /** Construction options every `iam` REST client accepts. */
  IamApiClientOptions,
} from './client/base.ts'
export { OtpNotifierRTO, PhoneConfirmRTO, PhoneEnrollRTO } from './rtos/password.ts'
export type { MessageResponse } from './rtos/common.ts'
