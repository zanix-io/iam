/**
 * @module
 *
 * Everything a trusted service needs to reset the authenticator app of an account on behalf of an
 * operator it authenticated itself — the `./ui/sdk/totp-service` subpath. Use it when the operators
 * live in another identity directory than the accounts they help. The service signs in with its own
 * credential (see `TotpServiceClient`), and `iam` serves it only when it is listed in
 * `IAM_TOTP_RESET_SERVICES`. Operators of this same `iam` use `./ui/sdk/totp-admin` instead.
 */
export { TotpServiceClient } from './client/totp-service.client.ts'
export type { TotpServiceClientOptions } from './client/totp-service.client.ts'
export {
  /** The shared base class every `iam` REST client extends — see its own doc. */
  IamApiClient,
} from './client/base.ts'
export type {
  /** Construction options every `iam` REST client accepts. */
  IamApiClientOptions,
} from './client/base.ts'
export { TOTP_RESET_REASON_MAX } from './rtos/totp-admin.ts'
export type { TotpResetEvent, TotpResetResult, TotpResetsPage } from './rtos/totp-admin.ts'
export type { ServiceAccountLookup } from './rtos/totp-service.ts'
