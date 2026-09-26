import { BaseRTO, IsEmail, IsEnum, IsString } from '@zanix/validator'
import { NOTIFIERS, OAUTH_PROVIDERS } from 'utils/constants.ts'

/** `POST /login` body — email + password credentials. */
export class LoginRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor password!: string

  @IsEmail({ expose: true })
  accessor email!: string
}

/** A bare refresh/session token, optionally read from a body (`refresh`/`logout`). */
export class TokenRTO extends BaseRTO {
  @IsString({ expose: true, optional: true })
  accessor token: string | undefined
}

/** `:oauth` route param — which OAuth2 provider a login/callback request targets. */
export class OAuthQueryRTO extends BaseRTO {
  @IsEnum([...OAUTH_PROVIDERS], { expose: true })
  accessor oauth!: OauthProviders
}

/** `GET /login/:oauth` query string — optional. `email`, when given, is forwarded as-is into
 * `OAuth2Connector.generateAuthUrl({ loginHint })` (`@zanix/auth`), pre-filling/pre-selecting that
 * account on the provider's own chooser screen. The real shape this exists for: an
 * ALREADY-AUTHENTICATED caller connecting a provider to their own account (never login, which has
 * no known email yet) passing their OWN session's own known email — this endpoint itself stays
 * anonymous-reachable and never validates that the caller who eventually completes the flow is
 * who they claim; `AuthService.linkOauth` (the real connect step) still independently rejects a
 * mismatched email regardless of what was hinted here. */
export class OAuthAuthorizeSearchRTO extends BaseRTO {
  @IsEmail({ expose: true, optional: true })
  accessor email: string | undefined
}

/**
 * `POST /login/:oauth/callback` body — the authorization `code` from the provider's redirect
 * (this project's connectors are code-flow-only — `responseType: 'code'`, see `auth.app.ts`).
 */
export class OAuthLoginRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor code!: string
}

/**
 * `GET /login/otp/:email` query string — optional. `notifier`, when given, overrides the
 * account's own `otpNotifier` preference for THIS one dispatch only (e.g. a caller retrying
 * because the configured channel never arrived) — see `AuthService.loginWithOTP`'s own
 * `options.notifier` doc. Omitted, dispatch falls back to the account's stored preference.
 */
export class LoginOtpSearchRTO extends BaseRTO {
  @IsEnum([...NOTIFIERS], { expose: true, optional: true })
  accessor notifier: typeof NOTIFIERS[number] | undefined
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

/** `POST /login/reactivate` body — the short-lived token `AuthService.challengeReactivation` minted
 * after a real OTP/OAuth identity check against an `'INACTIVE'` account. See that method's own doc,
 * and `AuthService.confirmReactivation`'s. */
export class ReactivationConfirmRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor reactivationToken!: string
}
