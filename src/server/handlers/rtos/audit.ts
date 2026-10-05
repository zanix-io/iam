import { IsEnum, IsString, Match } from '@zanix/validator'
import { SearchPaginationRTO } from '@zanix/datamaster'
import { AUDIT_RESULTS, AUDIT_TARGET_KINDS } from '../../repositories/audit/model.defs.ts'

/** An ISO 8601 date (`2026-10-05`) or date and time in UTC (`2026-10-05T12:00:00Z`). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z)?$/

/** `GET /audit` query — paginated, newest first; every filter is optional and they combine. */
export class SearchAuditRTO extends SearchPaginationRTO {
  /** The `auth` id of whoever made the change. */
  @IsString({ expose: true, optional: true })
  accessor actor: string | undefined

  /** What was changed: a role, an account, a permission or a user profile. */
  @IsEnum([...AUDIT_TARGET_KINDS], { expose: true, optional: true })
  accessor targetKind: typeof AUDIT_TARGET_KINDS[number] | undefined

  /** The id of what was changed. */
  @IsString({ expose: true, optional: true })
  accessor targetId: string | undefined

  /** The operation, as `<domain>.<operation>`, e.g. `roles.add`. */
  @Match(/^[a-z]+\.[a-z-]+$/, { expose: true, optional: true })
  @IsString({ expose: true, optional: true })
  accessor action: string | undefined

  @IsEnum([...AUDIT_RESULTS], { expose: true, optional: true })
  accessor result: typeof AUDIT_RESULTS[number] | undefined

  /** Only events at or after this instant. */
  @Match(ISO_DATE, { expose: true, optional: true })
  @IsString({ expose: true, optional: true })
  accessor from: string | undefined

  /** Only events at or before this instant. */
  @Match(ISO_DATE, { expose: true, optional: true })
  @IsString({ expose: true, optional: true })
  accessor to: string | undefined
}
