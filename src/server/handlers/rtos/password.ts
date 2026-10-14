import { BaseRTO, IsEmail, IsEnum, IsString, Match } from '@zanix/validator'
import { NOTIFIERS } from 'utils/constants.ts'

/** E.164 phone shape (`/^\+?[1-9]\d{1,14}$/`) — same regex `@zanix/validator`'s own `@IsPhone`
 * enforces. `transform: normalizePhone` strips the punctuation a human naturally types (spaces,
 * hyphens, parentheses) BEFORE validating, so `"+1 (415) 555-1234"` passes the same strict
 * digits-only check a raw E.164 string does, and the value actually persisted
 * (`AuthService.phoneConfirm` → `auth.phone`) is always the normalized form. */
const PHONE_REGEX = /^\+?[1-9]\d{1,14}$/

function normalizePhone(value?: string): string {
  return (value ?? '').replace(/[\s()-]/g, '')
}

/** `POST /pwd/change` body — self-service password change, authenticated session required. */
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
 * secret the preceding `totpEnroll()` call issued before it's persisted (see
 * `AuthService.totpConfirm`).
 */
export class TotpConfirmRTO extends BaseRTO {
  /** The secret the client enrolled. Optional and never used as the secret: the server confirms
   * the pending secret it issued, and refuses a body whose `secret` is another one. */
  @IsString({ expose: true, optional: true })
  accessor secret: string | undefined

  @IsString({ expose: true })
  accessor code!: string
}

/** The form body of the hosted `totp/confirm` page: {@linkcode TotpConfirmRTO} plus the
 * second-factor code that confirms the change (see `AuthService.provideFactorChangeProof`). */
export class TotpConfirmPageRTO extends TotpConfirmRTO {
  /** The current second-factor code of the account. */
  @IsString({ expose: true })
  accessor stepUpCode!: string
}

/** `POST /login/phone/enroll` body — starts phone verification (see `AuthService.phoneEnroll`). */
export class PhoneEnrollRTO extends BaseRTO {
  @Match(PHONE_REGEX, { expose: true, transform: normalizePhone })
  accessor phone!: string
}

/** `POST /login/phone/confirm` body — proves the caller received the SMS code `phoneEnroll` sent
 * to `phone`, before it's persisted (see `AuthService.phoneConfirm`). */
export class PhoneConfirmRTO extends BaseRTO {
  @Match(PHONE_REGEX, { expose: true, transform: normalizePhone })
  accessor phone!: string

  @IsString({ expose: true })
  accessor code!: string
}

/** The form body of the hosted `phone/confirm` page: {@linkcode PhoneConfirmRTO} plus the
 * second-factor code that confirms the change (see `AuthService.provideFactorChangeProof`). */
export class PhoneConfirmPageRTO extends PhoneConfirmRTO {
  /** The current second-factor code of the account. */
  @IsString({ expose: true })
  accessor stepUpCode!: string
}

/** `POST /login/otp-notifier` body — the caller's own login-OTP delivery-channel preference (see
 * `AuthService.setOtpNotifier`). `notifier` omitted OR `''` both reset to the `'email'` default —
 * `''` is accepted explicitly, not just `optional`'s own "key absent" case, because a plain HTML
 * `<select>` always submits SOME value for the chosen option — a form's "Email" option submits an
 * empty string rather than omitting the field. `AuthService.setOtpNotifier` treats `''` and
 * `undefined` the same. */
export class OtpNotifierRTO extends BaseRTO {
  @IsEnum([...NOTIFIERS.filter((notifier) => notifier !== 'email'), ''], {
    expose: true,
    optional: true,
  })
  accessor notifier: 'sms' | 'whatsapp' | '' | undefined
}

/** `GET /pwd/recovery/:email` query: the language of the recovery message. */
export class MessageLangSearchRTO extends BaseRTO {
  /** A BCP 47 tag such as `es`; omitted, the request's `Accept-Language`. */
  @IsString({ expose: true, optional: true })
  accessor lang: string | undefined
}
