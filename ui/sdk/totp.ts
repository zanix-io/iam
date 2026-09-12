/**
 * @module
 *
 * Everything a consumer needs to complete `iam`'s authenticator-app (TOTP) login verification AND
 * enrollment flows — the `./sdk/totp` subpath, mirroring `LoginController`'s own grouping of both
 * under one real controller. See `./sdk/otp` for the out-of-band code sibling.
 */
export { TotpClient } from './client/totp.client.ts'
export type { IamApiClientOptions } from './client/base.ts'
export { TotpLoginRTO } from './rtos/login.ts'
export type { SecondFactorLoginResult, TotpEnrollResult } from './rtos/login.ts'
export { TotpConfirmRTO } from './rtos/password.ts'
export type { MessageResponse, SessionTokens } from './rtos/common.ts'
