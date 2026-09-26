/**
 * @module
 *
 * Everything a consumer needs to complete `iam`'s out-of-band OTP login/second-factor flow — the
 * `./sdk/otp` subpath. See `./sdk/login` for the primary-credential call that may trigger this
 * challenge in the first place.
 */
export { OtpClient } from './client/otp.client.ts'
export {
  /** The shared base class every `iam` REST client extends — see its own doc. */
  IamApiClient,
} from './client/base.ts'
export type {
  /** Construction options every `iam` REST client accepts. */
  IamApiClientOptions,
} from './client/base.ts'
export { OtpLoginRTO } from './rtos/login.ts'
export type {
  LoginChallengeResult,
  OtpCallbackResult,
  ReactivationChallengeResult,
  SecondFactorLoginResult,
} from './rtos/login.ts'
export type { MessageResponse, SessionTokens } from './rtos/common.ts'
