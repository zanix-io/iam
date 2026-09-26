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
