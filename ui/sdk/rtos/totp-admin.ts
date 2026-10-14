import { BaseRTO, IsObjectID, IsString, Match } from '@zanix/validator'

/**
 * @module
 *
 * Request/response shapes for `iam`'s real `TotpAdminController` (`POST /admin/totp/reset`,
 * `GET /admin/totp/resets`). The request class mirrors
 * `iam/src/server/handlers/rtos/totp-admin.ts` field-for-field, kept in sync by hand for the same
 * reason `rtos/login.ts` is (see `rtos/common.ts`'s header doc).
 */

/** The longest reason an operator may give for a reset, after trimming. */
export const TOTP_RESET_REASON_MAX = 200

const REASON_TEXT = new RegExp(
  `^[^\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]{1,${TOTP_RESET_REASON_MAX}}$`,
  'u',
)

/** `POST /admin/totp/reset` body: the account and why its authenticator app is removed. */
export class TotpResetRTO extends BaseRTO {
  /** The `auth` id of the account (the id the roles endpoints address accounts by). */
  @IsObjectID({ expose: true })
  accessor authId!: string

  /** Why support removes the second factor: 1 to 200 characters once trimmed. */
  @Match(REASON_TEXT, { expose: true, transform: (value) => value?.trim() })
  @IsString({ expose: true })
  accessor reason!: string
}

/** `POST /admin/totp/reset`'s real response. */
export interface TotpResetResult {
  /** A short confirmation. */
  response: string
}

/** One recorded operator reset, as the audit trail stores it (`role_audit_events`). */
export interface TotpResetEvent {
  /** The audit event id. */
  id: string
  /** The `auth` id of the operator who made the reset. */
  actor?: string
  /** Always `'totp.reset'`. */
  action: string
  /** The account that was reset: `target.kind` is `'account'`. */
  target: { kind: string; id?: string }
  /** What the operator asked for: `{ reason }`. */
  request?: { reason?: string }
  /** The account before the reset: `{ totpEnabled, backupCodesRemaining }`. */
  before?: unknown
  /** The account after it. */
  after?: unknown
  /** How it ended: `pending`, `ok`, `denied`, `conflict`, `not-found` or `error`. */
  result: string
  /** The stable error code of a refusal. */
  reason?: string
  /** When the reset was attempted, as an ISO 8601 timestamp. */
  createdAt: string
}

/** `GET /admin/totp/resets`'s real response: one page of resets, newest first. */
export interface TotpResetsPage {
  /** How many resets match the query. */
  total: number
  /** The page returned, from 1. */
  page: number
  /** The page size. */
  limit: number
  /** The resets of this page, newest first. */
  docs: TotpResetEvent[]
}
