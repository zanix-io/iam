/**
 * @module
 *
 * Everything a consumer needs to build a custom login screen against `iam`'s real password and
 * OAuth2 endpoints — the `./sdk/login` subpath. See `./sdk/otp`/`./sdk/totp` for second-factor
 * verification once a {@link LoginChallengeResult} comes back from {@link LoginClient.login}.
 */
export { LoginClient } from './client/login.client.ts'
export {
  /** The shared base class every `iam` REST client extends — see its own doc. */
  IamApiClient,
} from './client/base.ts'
export type {
  /** Construction options every `iam` REST client accepts. */
  IamApiClientOptions,
} from './client/base.ts'
export {
  EmailFormRTO,
  EntryFormRTO,
  LoginRTO,
  OAuthLoginRTO,
  OAuthQueryRTO,
  ReactivationConfirmRTO,
  TokenRTO,
} from './rtos/login.ts'
export type {
  AuthMethodsResult,
  LoginChallengeResult,
  LoginMethodsResult,
  LoginResult,
  LoginSuccessResult,
  OauthAuthorizeResult,
  OauthCallbackResult,
  ReactivationChallengeResult,
  ReactivationConfirmResult,
  RefreshResult,
} from './rtos/login.ts'
export { OAUTH_PROVIDERS } from './rtos/common.ts'
export type { MessageResponse, OauthProvider, SessionTokens } from './rtos/common.ts'
