import { BaseRTO, IsEmail, IsEnum, IsString } from '@zanix/validator'
import { OAUTH_PROVIDERS, type OauthProvider, type SessionTokens } from './common.ts'
import type { TWO_FACTOR_METHODS } from 'utils/shared-enums.ts'

/**
 * @module
 *
 * Request/response shapes for `iam`'s real `LoginController` (`POST /login/login`,
 * `GET /login/otp/:email`, `POST /login/otp/callback`, `POST /login/totp/callback`,
 * `GET /login/:oauth`, `POST /login/:oauth/callback`, `POST /login/:oauth/link`,
 * `DELETE /login/:oauth`, `GET /login/methods`, `GET /login/methods/:email`,
 * `POST /login/refresh`, `POST /login/logout`, `GET /login/totp/enroll`,
 * `POST /login/totp/confirm`) — endpoint paths as they appear in `iam`'s own generated OpenAPI
 * spec (`zanix generate openapi`).
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

/** The body of a sign-in entry form: an email, and a password for an account that has one. Used
 * as the `@Page` action body of a two-step sign-in page and of its methods lookup. */
export class EntryFormRTO extends BaseRTO {
  @IsEmail({ expose: true })
  accessor email!: string

  @IsString({ expose: true, optional: true })
  accessor password: string | undefined
}

/** The body of a form that carries only an email, such as a password-recovery request. */
export class EmailFormRTO extends BaseRTO {
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

/** `POST /login/reactivate` body — the short-lived token `OtpClient.verify`/`LoginClient.oauthCallback`
 * returned instead of session tokens (see {@link ReactivationChallengeResult}'s own doc). */
export class ReactivationConfirmRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor reactivationToken!: string
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
 * directly — the account has 2FA configured to trigger on login. Branch on `method`: `'totp'`
 * continues at the authenticator-code step (`POST /login/totp/callback`); a notifier means a code
 * was just sent through that channel and continues at the one-time-code step
 * (`POST /login/otp/callback`). */
export interface LoginChallengeResult {
  /** Human-readable challenge message, for display only; branch on {@link method} instead. */
  message: string
  /** The account's own email address. A caller that never typed one — `POST
   * /login/:oauth/callback`, where the provider resolves it — needs it to build the next step's
   * URL (`/login/totp/:email` or `/login/otp/:email`). */
  email: string
  /** The second factor the account must complete: `'totp'`, or the notifier a code was sent
   * through. */
  method: typeof TWO_FACTOR_METHODS[number]
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

/**
 * A real OTP/OAuth2 identity check just succeeded against an account whose linked `users` profile
 * is `'INACTIVE'` — instead of finishing login (or auto-reactivating silently), the account gets a
 * real chance to confirm it wants to come back. `reactivationToken` is short-lived
 * (`REACTIVATION_TOKEN_EXPIRATION`, `iam`'s own server-side constant) and single-purpose — exchange
 * it for a real session with `LoginClient.confirmReactivation` once the caller has actually
 * confirmed (e.g. clicked "yes, reactivate my account"). Narrow `OtpClient.verify`'s/
 * `LoginClient.oauthCallback`'s result with `'needsReactivationConfirm' in result`.
 */
export interface ReactivationChallengeResult {
  /** Always `true` — the discriminator to narrow on. */
  needsReactivationConfirm: true
  /** The short-lived token to pass to `LoginClient.confirmReactivation`. */
  reactivationToken: string
}

/** `POST /login/reactivate`'s real response — the same shape `POST /login/login` and
 * `POST /login/:oauth/callback` return: a completed login, or (rarer, but possible if the account
 * ALSO has 2FA configured) a second-factor challenge. Narrow with `'accessToken' in result`, same
 * as {@link LoginResult}. */
export type ReactivationConfirmResult = LoginResult

/** `POST /login/otp/callback`'s real response — {@link SecondFactorLoginResult} on a normal login,
 * {@link ReactivationChallengeResult} when the account was `'INACTIVE'`, or
 * {@link LoginChallengeResult} when the account ALSO has 2FA configured on a method that differs
 * from the channel this OTP was itself delivered through (see `AuthService.loginWithOTPCallback`'s
 * own doc, server-side, for exactly when that applies). Narrow with
 * `'needsReactivationConfirm' in result` first, then `'accessToken' in result` — a
 * `LoginChallengeResult` has neither. */
export type OtpCallbackResult =
  | SecondFactorLoginResult
  | ReactivationChallengeResult
  | LoginChallengeResult

/** `POST /login/:oauth/callback`'s real response — {@link LoginResult} on a normal login, or
 * {@link ReactivationChallengeResult} when the account was `'INACTIVE'`. Same narrowing order as
 * {@link OtpCallbackResult}'s own doc. */
export type OauthCallbackResult = LoginResult | ReactivationChallengeResult

/** `POST /login/refresh`'s real response — a fresh token pair, same shape as
 * {@link SecondFactorLoginResult}. */
export type RefreshResult = SecondFactorLoginResult

/** `GET /login/:oauth`'s real response — the provider's authorization URL to redirect the user
 * to, and the `state` value embedded in it (persist this, e.g. as a short-lived cookie, to compare
 * against the provider's own callback for CSRF protection). */
export interface OauthAuthorizeResult {
  /** The provider's authorization URL to redirect the user to. */
  url: string
  /** The `state` value embedded in {@link url} — compare it against the provider's callback. */
  state: string
}

/** `GET /login/totp/enroll`'s real response — a new, not-yet-persisted TOTP secret and its
 * authenticator-app provisioning URI (render this as a QR code). Confirm the enrollment with
 * `POST /login/totp/confirm` before the secret is actually stored on the account. */
export interface TotpEnrollResult {
  /** The new, not-yet-persisted TOTP secret — sent back with `POST /login/totp/confirm`. */
  secret: string
  /** The `otpauth://` provisioning URI for an authenticator app (render it as a QR code). */
  uri: string
}

/** `GET /login/methods`'s real response — a plain, already-sanitized summary of the caller's own
 * sign-in methods (never the raw `password`/`totpSecret` fields, which are `access: 'internal'` on
 * the real `auth` model and never serialized as-is). `phone` gets the same treatment, one step
 * softer: the last 4 digits only (`null` when none is verified yet). */
export interface AuthMethodsResult {
  /** The account's own login email. */
  email: string
  /** Whether a password is set (never the password itself). */
  hasPassword: boolean
  /** The linked OAuth2 provider, or `null` when none is linked. */
  oauthProvider: OauthProvider | null
  /** Whether TOTP (authenticator app) is the account's configured second factor. */
  totpEnabled: boolean
  /** The verified phone's last 4 digits (`••••1234`), or `null` when none is verified. */
  phone: string | null
  /** Which channel a passwordless login-OTP code is delivered through — `null` means `'email'`,
   * the default (see `AuthenticationAttrs.otpNotifier`'s own doc, the real server-side field this
   * mirrors). Only ever `'sms'`/`'whatsapp'` when `phone` above is also non-`null`. */
  otpNotifier: 'sms' | 'whatsapp' | null
}

/**
 * `GET /login/methods/:email`'s real response — which login method(s) are configured for that
 * email, the step-1 lookup of a two-step login flow (collect the email, then show a password field
 * or fall through to the existing OTP flow). **Deliberately identical for a nonexistent email and
 * an existing one with no password/OAuth2 method configured** — `{ hasPassword: false,
 * oauthProviders: [], otpNotifier: null, hasVerifiedPhone: false }` either way. See
 * `AuthService.resolveLoginMethods`'s own doc (the real handler) for the full email-enumeration
 * rationale; a consumer UI should treat this default exactly like any other unrecognized email and
 * fall through to the OTP flow, never surface it as "this account has no password".
 */
export interface LoginMethodsResult {
  /** Whether a password is set for this email — `false` for a nonexistent email too. */
  hasPassword: boolean
  /** The OAuth2 providers linked to this email — `[]` for a nonexistent email too. */
  oauthProviders: OauthProvider[]
  /** Which channel a passwordless login-OTP code will actually dispatch to — same
   * `'sms' | 'whatsapp' | null` convention (`null` means `'email'`) as
   * `AuthMethodsResult.otpNotifier`, the authenticated equivalent of this same field. */
  otpNotifier: 'sms' | 'whatsapp' | null
  /** Whether an alternate delivery channel (`'sms'`/`'whatsapp'`) is even deliverable for this
   * account at all — `false` for any account with no verified phone, same case `otpNotifier` is
   * always `null` for too (there is nothing to switch TO). A consumer UI uses this (never
   * `otpNotifier` alone) to decide whether an OTP-resend screen's own "try a different method"
   * affordance has anything real to offer. */
  hasVerifiedPhone: boolean
}
