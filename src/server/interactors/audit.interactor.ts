import type { SearchAuditRTO } from '../handlers/rtos/audit.ts'

import { HttpError } from '@zanix/errors'
import { Interactor, ZanixInteractor } from '@zanix/server'
import { AuditRepository } from '../repositories/audit/entity.provider.ts'
import { AUDIT_SORT_FIELDS } from '../repositories/audit/model.defs.ts'

/**
 * Reads the audit trail of role, permission and account-status changes (`role_audit_events`).
 * Writing it is `audited()` in `audit.ts`, called by the services that mutate; this service only
 * lists.
 */
@Interactor()
export class AuditService extends ZanixInteractor {
  /**
   * One page of audit events, newest first, filtered by whoever made the change (`actor`), what
   * was changed (`targetKind`, `targetId`), the operation (`action`), how it ended (`result`) and
   * a date range (`from`, `to`).
   *
   * `sortBy` may only name the fields the collection is indexed by (`AUDIT_SORT_FIELDS`).
   *
   * @throws {HttpError} `BAD_REQUEST` when a date is not a real date, `from` is after `to`, or
   *   `sortBy` names another field.
   */
  public async searchEvents(options: Partial<SearchAuditRTO> = {}) {
    const { from, to, ...filters } = options
    const unsortable = Object.keys(filters.sortBy ?? {}).filter((field) =>
      !(AUDIT_SORT_FIELDS as readonly string[]).includes(field)
    )
    if (unsortable.length) {
      throw new HttpError('BAD_REQUEST', {
        message: `'sortBy' may only name: ${AUDIT_SORT_FIELDS.join(', ')}.`,
      })
    }
    const range = { from: this.#date(from, 'from'), to: this.#date(to, 'to') }
    if (range.from && range.to && range.from > range.to) {
      throw new HttpError('BAD_REQUEST', { message: "'from' must not be after 'to'." })
    }
    return await this.providers.get(AuditRepository).searchEvents({ ...filters, ...range })
  }

  #date(value: string | undefined, field: string) {
    if (!value) return undefined
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      throw new HttpError('BAD_REQUEST', { message: `'${field}' is not a valid date.` })
    }
    return date
  }
}
