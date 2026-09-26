/**
 * @module
 *
 * Everything a consumer needs to complete `iam`'s authenticator-app (TOTP) login verification,
 * enrollment, and disabling flows — the `./sdk/totp` subpath, mirroring `LoginController`'s own
 * grouping of all three under one real controller. See `./sdk/otp` for the out-of-band code
 * sibling.
 */
export { TotpClient } from './client/totp.client.ts'
export {
  /** The shared base class every `iam` REST client extends — see its own doc. */
  IamApiClient,
} from './client/base.ts'
export type {
  /** Construction options every `iam` REST client accepts. */
  IamApiClientOptions,
} from './client/base.ts'
export { TotpLoginRTO } from './rtos/login.ts'
export type { SecondFactorLoginResult, TotpEnrollResult } from './rtos/login.ts'
export { TotpConfirmRTO } from './rtos/password.ts'
export type { MessageResponse, SessionTokens } from './rtos/common.ts'
