import type { ZanixMongoConnector } from '@zanix/datamaster'
import type { AuditEventAttrs } from './model.defs.ts'

import { Provider, ZanixProvider } from '@zanix/server'

/** The filters of {@linkcode AuditRepository.searchEvents}; every one is optional. */
export type AuditSearch = {
  actor?: string
  targetKind?: string
  targetId?: string
  action?: string
  result?: string
  from?: Date
  to?: Date
  page?: number
  limit?: number
  sortBy?: Record<string, 1 | -1>
}

/**
 * Provider for the `role_audit_events` model — the persistent record of changes to roles,
 * permissions and account status. See `model.defs.ts` for the shape and the retention.
 *
 * @class
 * @extends ZanixProvider
 */
@Provider()
export class AuditRepository extends ZanixProvider<{ database: ZanixMongoConnector }> {
  /** The Mongoose model bound to the `role_audit_events` collection. */
  private Model
  constructor() {
    super()
    this.Model = this.database.getModel<AuditEventAttrs>('role_audit_events')
  }

  /** Records an operation as `pending`, before it changes anything; answers the event's id. */
  public async begin(event: Omit<AuditEventAttrs, 'id' | 'result' | 'createdAt' | 'updatedAt'>) {
    const doc = await new this.Model({ ...event, result: 'pending' }).save()
    return String(doc.id)
  }

  /** Closes the event `id` with the final `result`, its `reason`, what the target held before and
   * after, and its id when it only exists once the operation ran (a role just created). */
  public finish(
    id: string,
    result: AuditEventAttrs['result'],
    details: { reason?: string; before?: unknown; after?: unknown; targetId?: string } = {},
  ) {
    const { targetId, ...rest } = details
    const set: Record<string, unknown> = { result }
    for (const [key, value] of Object.entries(rest)) if (value !== undefined) set[key] = value
    if (targetId !== undefined) set['target.id'] = targetId
    return this.Model.updateOne({ _id: id }, { $set: set }).exec()
  }

  /** Paginated, filterable listing of events, newest first. */
  public searchEvents(options: AuditSearch = {}) {
    const { actor, targetKind, targetId, action, result, from, to, page, limit, sortBy } = options
    const filter: Record<string, unknown> = {}
    if (actor) filter.actor = actor
    if (targetKind) filter['target.kind'] = targetKind
    if (targetId) filter['target.id'] = targetId
    if (action) filter.action = action
    if (result) filter.result = result
    if (from || to) {
      filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) }
    }
    return this.Model.paginate({ page, limit, sort: sortBy ?? { createdAt: -1 }, filter })
  }
}
