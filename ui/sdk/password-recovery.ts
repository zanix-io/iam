/**
 * @module
 *
 * Everything a consumer needs to build a forgot-password flow AND a self-service password-change
 * form against `iam`'s real `PasswordController` — the `./sdk/password-recovery` subpath. Named
 * after its most prominent flow (matching this SDK's other flow-named subpaths), but its client
 * covers that controller's full real surface, `PwdRTO`-backed self-service change included — see
 * `PasswordClient`'s own header doc.
 */
export { PasswordClient } from './client/password.client.ts'
export {
  /** The shared base class every `iam` REST client extends — see its own doc. */
  IamApiClient,
} from './client/base.ts'
export type {
  /** Construction options every `iam` REST client accepts. */
  IamApiClientOptions,
} from './client/base.ts'
export { PwdRecoveryCbRTO, PwdRTO } from './rtos/password.ts'
export type { MessageResponse, PasswordRecoveryResult } from './rtos/password.ts'
export type { SessionTokens } from './rtos/common.ts'
