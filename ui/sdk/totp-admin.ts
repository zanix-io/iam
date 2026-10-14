/**
 * @module
 *
 * Everything an operator console needs to reset the authenticator app of an account whose owner
 * lost it, and to list those resets — the `./ui/sdk/totp-admin` subpath. The calls need the
 * `totp-reset` permission; the account's owner uses `./ui/sdk/totp` instead.
 */
export { TotpAdminClient } from './client/totp-admin.client.ts'
export {
  /** The shared base class every `iam` REST client extends — see its own doc. */
  IamApiClient,
} from './client/base.ts'
export type {
  /** Construction options every `iam` REST client accepts. */
  IamApiClientOptions,
} from './client/base.ts'
export { TOTP_RESET_REASON_MAX, TotpResetRTO } from './rtos/totp-admin.ts'
export type { TotpResetEvent, TotpResetResult, TotpResetsPage } from './rtos/totp-admin.ts'
