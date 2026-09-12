import { BaseRTO, IsEmail, IsString } from '@zanix/validator'
import type { SessionTokens } from './common.ts'

/**
 * @module
 *
 * Request/response shapes for `iam`'s real `PasswordController` (`POST /pwd/change`,
 * `POST /pwd/add`, `DELETE /pwd/remove`, `GET /pwd/recovery/:email`,
 * `POST /pwd/recovery/callback`) plus `TotpConfirmRTO`, which lives in
 * the real `iam/src/server/handlers/rtos/password.ts` file too even though it backs a
 * `LoginController` route (`POST /login/totp/confirm`) — mirrored here in the same grouping as the
 * real source, not by which controller consumes it. Real endpoint paths confirmed against `iam`'s
 * own generated OpenAPI spec.
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
