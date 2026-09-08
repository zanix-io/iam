import { BaseRTO, IsEmail, IsEnum, IsString } from '@zanix/validator'
import { OAUTH_PROVIDERS } from 'utils/constants.ts'

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

/**
 * `POST /login/:oauth/callback` body — the authorization `code` from the provider's redirect
 * (this project's connectors are code-flow-only, see `auth-oauth2`'s security rationale).
 */
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
