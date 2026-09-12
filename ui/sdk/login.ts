/**
 * @module
 *
 * Everything a consumer needs to build a custom login screen against `iam`'s real password and
 * OAuth2 endpoints — the `./sdk/login` subpath. See `./sdk/otp`/`./sdk/totp` for second-factor
 * verification once a {@link LoginChallengeResult} comes back from {@link LoginClient.login}.
 */
export { LoginClient } from './client/login.client.ts'
export type { IamApiClientOptions } from './client/base.ts'
export { LoginRTO, OAuthLoginRTO, OAuthQueryRTO, TokenRTO } from './rtos/login.ts'
export type {
  AuthMethodsResult,
  LoginChallengeResult,
  LoginResult,
  LoginSuccessResult,
  OauthAuthorizeResult,
  RefreshResult,
} from './rtos/login.ts'
export { OAUTH_PROVIDERS } from './rtos/common.ts'
export type { MessageResponse, OauthProvider, SessionTokens } from './rtos/common.ts'
