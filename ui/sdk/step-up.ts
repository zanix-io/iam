/**
 * @module
 *
 * Everything a consumer needs to re-verify a signed-in user's second factor ahead of a sensitive
 * action — the `./sdk/step-up` subpath. That includes changing a second factor or a credential of
 * the account itself (purpose {@linkcode FACTOR_CHANGE_PURPOSE}, `bind` one of
 * {@linkcode FACTOR_CHANGE_OPERATIONS}); the `TotpClient`, `PhoneClient` and `PasswordClient`
 * methods that make those changes take the token and send it in {@linkcode STEP_UP_TOKEN_HEADER}.
 * The factor follows the user's own settings (see
 * `./sdk/totp` for enrolling an authenticator app, `./sdk/otp` for the code channels). The token
 * `StepUpClient.verify` returns is checked by the service that performs the action; its claims are
 * {@link StepUpTokenClaims}.
 */
export {
  /** The operations that need it; each is also the `bind` of the token. */
  FACTOR_CHANGE_OPERATIONS,
  /** The step-up `purpose` that authorizes changing a second factor or a credential. */
  FACTOR_CHANGE_PURPOSE,
  /** The request header that carries the token to those operations. */
  STEP_UP_TOKEN_HEADER,
} from 'utils/shared-enums.ts'
export type { FactorChangeOperation } from 'utils/shared-enums.ts'
export { StepUpClient } from './client/step-up.client.ts'
export {
  /** The shared base class every `iam` REST client extends — see its own doc. */
  IamApiClient,
} from './client/base.ts'
export type {
  /** Construction options every `iam` REST client accepts. */
  IamApiClientOptions,
} from './client/base.ts'
export { StepUpRequestRTO, StepUpVerifyRTO } from './rtos/step-up.ts'
export type { StepUpRequestResult, StepUpTokenClaims, StepUpVerifyResult } from './rtos/step-up.ts'
