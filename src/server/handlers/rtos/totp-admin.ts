import { BaseRTO, IsObjectID, IsString, Match } from '@zanix/validator'
import { SearchPaginationRTO } from '@zanix/datamaster'

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
