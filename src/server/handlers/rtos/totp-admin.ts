import { BaseRTO, IsObjectID, IsString, Match } from '@zanix/validator'
import { SearchPaginationRTO } from '@zanix/datamaster'
import { IsLookupEmail } from './validations/is-lookup-email.ts'
import { IsOperatorRef } from './validations/is-operator-ref.ts'

/** The longest reason an operator may give for a reset, after trimming. */
export const TOTP_RESET_REASON_MAX = 200

/** 1 to {@linkcode TOTP_RESET_REASON_MAX} characters with no control character, bidirectional mark
 * or zero-width character (Unicode categories Cc, Cf, Zl, Zp). Spaces inside are allowed. */
const REASON_TEXT = new RegExp(
  `^[^\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]{1,${TOTP_RESET_REASON_MAX}}$`,
  'u',
)

/**
 * `POST /admin/totp/reset` body: the account whose authenticator app is removed, and why. The
 * reason is trimmed before it is checked and stored, so it is never empty, and travels in the
 * body, never in a URL.
 */
export class TotpResetRTO extends BaseRTO {
  /** The `auth` id of the account (the `authId` the roles endpoints address accounts by). */
  @IsObjectID({ expose: true })
  accessor authId!: string

  /** Why support removes the second factor: 1 to 200 characters once trimmed. */
  @Match(REASON_TEXT, { expose: true, transform: (value) => value?.trim() })
  @IsString({ expose: true })
  accessor reason!: string
}

/** `GET /admin/totp/resets` query: paginated, newest first; `authId` keeps the resets of one account. */
export class SearchTotpResetsRTO extends SearchPaginationRTO {
  @IsObjectID({ expose: true, optional: true })
  accessor authId: string | undefined
}

/** `POST /admin/service/token` body: the signed assertion of a service (see `@zanix/auth`'s
 * `createServiceAssertion`). */
export class ServiceTokenRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor assertion!: string
}

/** `POST /admin/service/accounts/lookup` body: the exact email of the account, never in a URL. */
export class ServiceLookupAccountRTO extends BaseRTO {
  @IsLookupEmail({ expose: true, transform: (value) => value?.trim() })
  accessor email!: string
}

/**
 * `POST /admin/service/totp/reset` body: the account, why, and the operator the calling service
 * vouches for. `operator.id` is opaque to `iam` and lands in the audit event next to the service.
 */
export class ServiceTotpResetRTO extends TotpResetRTO {
  @IsOperatorRef({ expose: true })
  accessor operator!: { id: string }
}
