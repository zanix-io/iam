import { BaseRTO, IsEmail, IsEnum, IsString, Match } from '@zanix/validator'
import { NOTIFIERS } from 'utils/shared-enums.ts'
import type { SessionTokens } from './common.ts'

/** The real `NOTIFIERS` (`utils/shared-enums.ts`), minus `'email'` — never a valid override
 * target for this account-preference RTO (see `OtpNotifierRTO`'s own doc: an empty value is how a
 * caller resets back to email, not the literal string `'email'`). A plain mutable array, not
 * `as const` — `@zanix/validator`'s own `@IsEnum` `EnumType` param doesn't structurally accept a
 * readonly tuple. */
const OTP_NOTIFIERS: string[] = NOTIFIERS.filter((notifier) => notifier !== 'email')

/** Same E.164 shape/normalization as the real `iam/src/server/handlers/rtos/password.ts` mirror —
 * see that file's own doc for the full "why `Match` + a transform, not a bare regex" reasoning. */
const PHONE_REGEX = /^\+?[1-9]\d{1,14}$/
function normalizePhone(value?: string): string {
  return (value ?? '').replace(/[\s()-]/g, '')
}

/**
 * @module
 *
 * Request/response shapes for `iam`'s real `PasswordController` (`POST /pwd/change`,
 * `POST /pwd/add`, `DELETE /pwd/remove`, `GET /pwd/recovery/:email`,
 * `POST /pwd/recovery/callback`) plus `TotpConfirmRTO`/`PhoneEnrollRTO`/`PhoneConfirmRTO`/
 * `OtpNotifierRTO`, which live in the real `iam/src/server/handlers/rtos/password.ts` file too
 * even though they back `LoginController` routes (`POST /login/totp/confirm`,
 * `/login/phone/enroll`, `/login/phone/confirm`, `/login/otp-notifier`) — mirrored here in the
 * same grouping as the real source, not by which controller consumes them. Real endpoint paths
 * confirmed against `iam`'s own generated OpenAPI spec.
 *
 * Every request class mirrors `iam/src/server/handlers/rtos/password.ts` field-for-field — see
 * `rtos/common.ts`'s own header doc for why this is a hand-kept mirror, not a re-export.
 */

/** `POST /pwd/change` body — self-service password change, requires an authenticated session
 * (send `Authorization: Bearer <accessToken>`). */
export class PwdRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor currentPassword!: string

  @IsString({ expose: true })
  accessor newPassword!: string
}

/** `POST /pwd/add` body — sets a first password for an account that doesn't have one yet, no
 * `currentPassword` to prove (there isn't one) — a distinct RTO/route from `PwdRTO`/`change`,
 * never an optional field on it. */
export class AddPasswordRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor newPassword!: string
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
 * secret from a preceding `GET /login/totp/enroll` call before it's persisted. Requires an
 * authenticated session, same as enrollment itself.
 */
export class TotpConfirmRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor secret!: string

  @IsString({ expose: true })
  accessor code!: string
}

/** `POST /login/phone/enroll` body — starts phone verification. Requires an authenticated
 * session, same as TOTP enrollment. */
export class PhoneEnrollRTO extends BaseRTO {
  @Match(PHONE_REGEX, { expose: true, transform: normalizePhone })
  accessor phone!: string
}

/** `POST /login/phone/confirm` body — proves the caller received the SMS code `phone/enroll`
 * sent to `phone`, before it's persisted. */
export class PhoneConfirmRTO extends BaseRTO {
  @Match(PHONE_REGEX, { expose: true, transform: normalizePhone })
  accessor phone!: string

  @IsString({ expose: true })
  accessor code!: string
}

/** `POST /login/otp-notifier` body — the caller's own login-OTP delivery-channel preference.
 * `notifier` omitted OR `''` both reset to the `'email'` default — see the real
 * `iam/src/server/handlers/rtos/password.ts` mirror's own doc for why `''` is accepted explicitly,
 * not just relying on `optional`'s "key absent" case. */
export class OtpNotifierRTO extends BaseRTO {
  @IsEnum([...OTP_NOTIFIERS, ''], { expose: true, optional: true })
  accessor notifier: 'sms' | 'whatsapp' | '' | undefined
}

/** `POST /pwd/change`, `GET /pwd/recovery/:email`, and `POST /login/totp/confirm`'s real
 * response shape — reused directly rather than re-declared, since all three genuinely return the
 * same generic dispatch/action confirmation. */
export type { MessageResponse } from './common.ts'

/** `POST /pwd/recovery/callback`'s real response — session tokens with no `mustChangePassword`
 * field (only a primary-credential login carries that flag). */
export interface PasswordRecoveryResult extends SessionTokens {
  /** Seconds until `accessToken` expires — see `rtos/login.ts`'s
   * `LoginSuccessResult.expiresAt`'s own doc for why this is a duration, not a Unix epoch
   * timestamp. */
  expiresAt: number
}
