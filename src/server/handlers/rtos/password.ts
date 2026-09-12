import { BaseRTO, IsEmail, IsString } from '@zanix/validator'

/** `POST /pwd` body — self-service password change, authenticated session required. */
export class PwdRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor currentPassword!: string

  @IsString({ expose: true })
  accessor newPassword!: string
}

/** `POST /pwd/add` body — sets a first password for an account that doesn't have one yet, no
 * `currentPassword` to prove (there isn't one) — see `PasswordService.addPassword`'s own doc for
 * why this is a distinct RTO/route from `PwdRTO`/`change`, never an optional field on it. */
export class AddPasswordRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor newPassword!: string
}

/** `GET /pwd/recovery/:email` and `GET /login/otp/:email` param — URI-decoded defensively (an
 * email can carry `+`/`%`). */
export class PwdRecoveryRTO extends BaseRTO {
  /** URI-decodes `data.email` defensively, falling back to the raw value if decoding fails. */
  constructor(data: PwdRecoveryRTO) {
    super()
    try {
      this.email = decodeURIComponent(data.email)
    } catch {
      this.email = data.email
    }
  }
  @IsEmail()
  accessor email: string
}

/** `POST /pwd/recovery/callback` body — the recovery code plus the new password to set. */
export class PwdRecoveryCbRTO extends BaseRTO {
  @IsEmail({ expose: true })
  accessor email!: string

  @IsString({ expose: true })
  accessor password!: string

  @IsString({ expose: true })
  accessor code!: string
}

/**
 * `POST /login/totp/confirm` body — proves the caller's authenticator app actually holds the
 * secret from a preceding `totpEnroll()` call before it's persisted (see `AuthService.totpConfirm`).
 */
export class TotpConfirmRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor secret!: string

  @IsString({ expose: true })
  accessor code!: string
}
