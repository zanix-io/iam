import type {
  AuthMethodsResult,
  LoginResult,
  OauthAuthorizeResult,
  RefreshResult,
} from '../rtos/login.ts'
import type { MessageResponse, OauthProvider } from '../rtos/common.ts'

import { IamApiClient } from './base.ts'
import { LoginRTO, OAuthLoginRTO, TokenRTO } from '../rtos/login.ts'

/**
 * Thin REST client over `iam`'s real `LoginController` — password login, OAuth2 authorization/
 * callback, refresh, and logout. See `OtpClient`/`TotpClient` for the second-factor endpoints this
 * controller also owns.
 *
 * @example
 * ```ts
 * const login = new LoginClient({ baseUrl: 'https://iam.example.com' })
 * const result = await login.login('user@example.com', 'correct horse battery staple')
 * if ('accessToken' in result) {
 *   // logged in — result.accessToken/result.refreshToken are ready to store
 * } else {
 *   // result.message — a second factor is required, continue with OtpClient/TotpClient
 * }
 * ```
 */
export class LoginClient extends IamApiClient {
  /**
   * Authenticates with `email`/`password`.
   *
   * @returns Session tokens, or a second-factor challenge when the account has 2FA configured to
   * trigger on login — narrow the result with `'accessToken' in result`.
   * @throws {RestClientError} `realHttpStatus === 403` for an invalid email/password pair.
   */
  public login(email: string, password: string): Promise<LoginResult> {
    const body = new LoginRTO()
    body.email = email
    body.password = password
    return this.http.post<LoginResult>('login/login', { body: JSON.stringify(body) })
  }

  /**
   * Starts the OAuth2 flow for `provider` (one of `iam`'s configured {@link OauthProvider}s).
   *
   * @returns The provider's authorization URL to redirect the user to, plus the `state` value
   * embedded in it — persist `state` (e.g. a short-lived cookie) so it can be compared against the
   * provider's own callback for CSRF protection, the same way `iam`'s own hosted login page does.
   * @throws {RestClientError} `realHttpStatus === 400` when `provider` isn't configured on this
   * deployment.
   */
  public oauthAuthorize(provider: OauthProvider): Promise<OauthAuthorizeResult> {
    return this.http.get<OauthAuthorizeResult>(`login/${provider}`)
  }

  /**
   * Completes the OAuth2 flow for `provider`: `code` is the authorization code from the
   * provider's own redirect — never a client-obtained bearer token (this SDK's providers are
   * code-flow-only, matching `iam`'s own connector configuration).
   *
   * @returns The same shape as {@link login} — session tokens, or a second-factor challenge.
   * @throws {RestClientError} `realHttpStatus === 403` when the provider returns no verified
   * email, or no account exists and self-registration is disabled; `409` when the resolved email
   * is already registered through a different sign-in method.
   */
  public oauthCallback(provider: OauthProvider, code: string): Promise<LoginResult> {
    const body = new OAuthLoginRTO()
    body.code = code
    return this.http.post<LoginResult>(`login/${provider}/callback`, {
      body: JSON.stringify(body),
    })
  }

  /**
   * Exchanges a refresh token for a new session token pair.
   *
   * @param token - Explicit refresh token. Omit it only when this client's own environment sends
   * `iam`'s refresh-token cookie automatically (e.g. a same-site browser request with
   * `credentials: 'include'`) — most SDK consumers should pass it explicitly. When passed, also
   * sent via `refreshIdentityHeaders` so `iam` rate-limits this call per real end user rather than
   * per caller IP — see that method's own doc (matters if you proxy this call through your own
   * backend on behalf of many end users).
   * @throws {RestClientError} `realHttpStatus === 403` when the token is expired, invalid, or
   * revoked.
   */
  public refresh(token?: string): Promise<RefreshResult> {
    const body = new TokenRTO()
    // Assigning `undefined` explicitly (rather than never touching the accessor at all) crashes
    // `BaseRTO`'s own accessor implementation (`@zanix/utils`) — a real, upstream bug independent
    // of this SDK, confirmed via isolated repro. Only assign when there's a real value; the
    // accessor's own unset state already serializes correctly (`{}`, no `token` key at all).
    if (token) body.token = token
    return this.http.post<RefreshResult>('login/refresh', {
      body: JSON.stringify(body),
      headers: token ? this.refreshIdentityHeaders(token) : undefined,
    })
  }

  /** Revokes `token`, ending that session. Requires an authenticated access token. */
  public logout(accessToken: string, token?: string): Promise<MessageResponse> {
    const body = new TokenRTO()
    // See `refresh`'s own doc for why `undefined` is never assigned directly here either.
    if (token) body.token = token
    return this.http.post<MessageResponse>('login/logout', {
      body: JSON.stringify(body),
      headers: this.authHeaders(accessToken),
    })
  }

  /** Returns a plain, sanitized summary of the caller's own sign-in methods. Requires an
   * authenticated access token — the target account is always the session's own subject. */
  public getOwnAuthMethods(accessToken: string): Promise<AuthMethodsResult> {
    return this.http.get<AuthMethodsResult>('login/methods', {
      headers: this.authHeaders(accessToken),
    })
  }

  /**
   * Connects `provider` to the CALLER'S OWN already-authenticated account — never a login, never
   * account creation. `code` is the authorization code from the provider's own redirect, same
   * code-flow-only shape as {@link oauthCallback}. Requires an authenticated access token.
   *
   * @throws {RestClientError} `realHttpStatus === 400` when `provider` isn't configured; `403`
   * when the provider returns no verified email; `409` when the provider's own verified email
   * doesn't match the caller's own account email (this endpoint never merges two accounts — sign
   * in with that email directly instead of connecting a different one).
   */
  public linkOauth(
    accessToken: string,
    provider: OauthProvider,
    code: string,
  ): Promise<MessageResponse> {
    const body = new OAuthLoginRTO()
    body.code = code
    return this.http.post<MessageResponse>(`login/${provider}/link`, {
      body: JSON.stringify(body),
      headers: this.authHeaders(accessToken),
    })
  }

  /** Disconnects `provider` from the caller's own account. A no-op (not an error) if it wasn't
   * connected in the first place. Requires an authenticated access token. */
  public unlinkOauth(accessToken: string, provider: OauthProvider): Promise<MessageResponse> {
    return this.http.delete<MessageResponse>(`login/${provider}`, {
      headers: this.authHeaders(accessToken),
    })
  }
}
