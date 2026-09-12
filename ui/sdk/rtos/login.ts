import { BaseRTO, IsEmail, IsEnum, IsString } from '@zanix/validator'
import { OAUTH_PROVIDERS, type OauthProvider, type SessionTokens } from './common.ts'

/**
 * @module
 *
 * Request/response shapes for `iam`'s real `LoginController` (`POST /login/login`,
 * `GET /login/otp/:email`, `POST /login/otp/callback`, `POST /login/totp/callback`,
 * `GET /login/:oauth`, `POST /login/:oauth/callback`, `POST /login/:oauth/link`,
 * `DELETE /login/:oauth`, `GET /login/methods`, `POST /login/refresh`, `POST /login/logout`,
 * `GET /login/totp/enroll`, `POST /login/totp/confirm`) — real endpoint paths confirmed against
 * `iam`'s own generated OpenAPI spec (`zanix generate openapi`), not assumed from a handler's own
 * default-path convention.
 *
 * Every request class here mirrors `iam/src/server/handlers/rtos/login.ts` field-for-field —
 * kept in sync by hand, not re-exported, since that file isn't reachable from any public subpath
 * (see `rtos/common.ts`'s own header doc for why). Response types have no real-RTO counterpart at
 * all (`iam`'s own handlers return plain objects) and are derived directly from
 * `AuthService`/`PasswordService`'s real return shapes instead.
 */

/** `POST /login/login` body — email + password credentials. */
export class LoginRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor password!: string

  @IsEmail({ expose: true })
  accessor email!: string
}

/** A bare refresh/session token, sent as the body of `POST /login/refresh` and
 * `POST /login/logout`. */
export class TokenRTO extends BaseRTO {
  @IsString({ expose: true, optional: true })
  accessor token: string | undefined
}

/** `:oauth` route param on `GET /login/:oauth` and `POST /login/:oauth/callback` — which
 * configured OAuth2 provider a login/callback request targets. */
export class OAuthQueryRTO extends BaseRTO {
  @IsEnum([...OAUTH_PROVIDERS], { expose: true })
  accessor oauth!: OauthProvider
}

/** `POST /login/:oauth/callback` body — the authorization `code` from the provider's own
 * redirect. */
export class OAuthLoginRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor code!: string
}

/** `POST /login/otp/callback` body — the OTP code sent to `email`. */
export class OtpLoginRTO extends BaseRTO {
  @IsEmail({ expose: true })
  accessor email!: string
  @IsString({ expose: true })
  accessor code!: string
}

/** `POST /login/totp/callback` body — the authenticator-app code for the enrolled account. */
export class TotpLoginRTO extends BaseRTO {
  @IsEmail({ expose: true })
  accessor email!: string
  @IsString({ expose: true })
  accessor code!: string
}

/** A completed login's session tokens, its access token's lifetime, and whether the account must
 * change its password before doing anything else — `AuthService.finishLogin`'s real success shape
 * (`POST /login/login`, `POST /login/:oauth/callback`). */
export interface LoginSuccessResult extends SessionTokens {
  /** Seconds until `accessToken` expires (a duration, NOT a Unix epoch timestamp) — mirrors
   * `iam`'s own `TOKEN_EXPIRATION` (`utils/constants.ts`), a 10s-margin-adjusted TTL. Compute an
   * absolute expiry yourself if you need one: `Date.now() + expiresAt * 1000`. */
  expiresAt: number
  /** `true` when the account has a pending forced password change (e.g. an admin-issued
   * temporary password) — a consumer's UI should route straight to a password-change form instead
   * of the app's normal post-login destination. */
  mustChangePassword: boolean
}

/** A login call short-circuited into a second-factor challenge instead of returning tokens
 * directly — the account has 2FA configured to trigger on login. `message` is a human-readable
 * confirmation (e.g. "a verification code has been sent" for OTP, or a prompt to enter an
 * authenticator code for TOTP) meant for direct display, not machine parsing; branch on which
 * follow-up endpoint the consumer's own UI already knows to call next (OTP vs. TOTP) rather than
 * on this string's exact wording. */
export interface LoginChallengeResult {
  message: string
}

/** `POST /login/login` and `POST /login/:oauth/callback`'s real response — either a completed
 * login or a second-factor challenge. Narrow on `'accessToken' in result` to tell them apart. */
export type LoginResult = LoginSuccessResult | LoginChallengeResult

/** `POST /login/otp/callback` and `POST /login/totp/callback`'s real response — session tokens
 * with no `mustChangePassword` field (only a primary-credential login carries that flag). */
export interface SecondFactorLoginResult extends SessionTokens {
  /** Seconds until `accessToken` expires — see {@link LoginSuccessResult.expiresAt}'s own doc for
   * why this is a duration, not a Unix epoch timestamp. */
  expiresAt: number
}

/** `POST /login/refresh`'s real response — a fresh token pair, same shape as
 * {@link SecondFactorLoginResult}. */
export type RefreshResult = SecondFactorLoginResult

/** `GET /login/:oauth`'s real response — the provider's authorization URL to redirect the user
 * to, and the `state` value embedded in it (persist this, e.g. as a short-lived cookie, to compare
 * against the provider's own callback for CSRF protection). */
export interface OauthAuthorizeResult {
  url: string
  state: string
}

/** `GET /login/totp/enroll`'s real response — a new, not-yet-persisted TOTP secret and its
 * authenticator-app provisioning URI (render this as a QR code). Confirm the enrollment with
 * `POST /login/totp/confirm` before the secret is actually stored on the account. */
export interface TotpEnrollResult {
  secret: string
  uri: string
}

/** `GET /login/methods`'s real response — a plain, already-sanitized summary of the caller's own
 * sign-in methods (never the raw `password`/`totpSecret` fields, which are `access: 'internal'` on
 * the real `auth` model and never serialized as-is). */
export interface AuthMethodsResult {
  email: string
  hasPassword: boolean
  oauthProvider: OauthProvider | null
  totpEnabled: boolean
}
