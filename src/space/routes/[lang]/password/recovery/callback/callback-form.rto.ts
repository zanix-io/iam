import { BaseRTO, IsEmail, IsString } from '@zanix/validator'

/** `./page.tsx`'s own request shape — the recovery code and new password plus its confirmation,
 * checked for a match in that page's own `action` before calling
 * `PasswordService.recoveryCallback` (which itself takes only `password`, never the confirmation —
 * the confirmation is purely this form's own validation, not part of the API contract). A local
 * RTO rather than
 * `server/handlers/rtos/password.ts`'s own `PwdRecoveryCbRTO` specifically because that one is the
 * real server-side RTO for `POST /pwd/recovery/callback`, which never receives `confirmPassword`
 * at all. */
export class RecoveryCallbackFormRTO extends BaseRTO {
  @IsEmail({ expose: true })
  accessor email!: string

  @IsString({ expose: true })
  accessor code!: string

  @IsString({ expose: true })
  accessor password!: string

  @IsString({ expose: true })
  accessor confirmPassword!: string
}
