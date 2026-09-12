/**
 * @module
 *
 * Everything a consumer needs to complete `iam`'s out-of-band OTP login/second-factor flow — the
 * `./sdk/otp` subpath. See `./sdk/login` for the primary-credential call that may trigger this
 * challenge in the first place.
 */
export { OtpClient } from './client/otp.client.ts'
export type { IamApiClientOptions } from './client/base.ts'
export { OtpLoginRTO } from './rtos/login.ts'
export type { SecondFactorLoginResult } from './rtos/login.ts'
export type { MessageResponse, SessionTokens } from './rtos/common.ts'
