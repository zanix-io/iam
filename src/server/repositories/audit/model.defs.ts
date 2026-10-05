import { registerModel, Schema } from '@zanix/datamaster'
import { auditRetentionDays } from 'utils/constants.ts'

/** What an audit event records a change to. */
export const AUDIT_TARGET_KINDS = ['role', 'account', 'permission', 'user'] as const

/** The fields `GET /audit` may sort by: the ones its indexes cover. */
export const AUDIT_SORT_FIELDS = ['createdAt', 'actor', 'action', 'result'] as const

/**
 * How an audited operation ended: `pending` is written before the change (so none is left without
 * a trace, even if the process stops midway), then it becomes `ok`, `denied` (a 403 from the
 * security rules), `conflict` (a 409), `not-found` (a lookup that found no person) or `error`
 * (anything else).
 */
export const AUDIT_RESULTS = [
  'pending',
  'ok',
  'denied',
  'conflict',
  'not-found',
  'error',
] as const

/**
 * The `role_audit_events` collection — an insert-and-close record of every mutation of roles,
 * permissions and account status, rejected attempts included. It holds ids, codes and counts only:
 * never an email, a token or a secret. Events expire after `AUDIT_RETENTION_DAYS` (default 365)
 * through the TTL index below.
 */
export type AuditEventAttrs = {
  id: string
  /** The `auth` id of the caller (`session.subject`), or the session id when it has none. */
  actor?: string
  /** `session.type`: `user`, `api` or `anonymous`. */
  actorType?: string
  /** What was attempted, as `<domain>.<operation>`, e.g. `roles.add`. */
  action: string
  target: { kind: typeof AUDIT_TARGET_KINDS[number]; id?: string }
  /** What the request asked for, as ids and plain values only. */
  request?: unknown
  /** What the target held before the change. */
  before?: unknown
  /** What it holds after the change. */
  after?: unknown
  result: typeof AUDIT_RESULTS[number]
  /** The stable `code` of the rejection (`IAM_ERROR_CODES`), or its HTTP status name. */
  reason?: string
  /** The request id (`ctx.id`), to correlate with the service logs. */
  requestId?: string
  createdAt: Date
  updatedAt: Date
}

registerModel<AuditEventAttrs>({
  name: 'role_audit_events',
  definition: {
    actor: String,
    actorType: String,
    action: { type: String, required: true },
    target: {
      kind: { type: String, enum: AUDIT_TARGET_KINDS, required: true },
      id: String,
    },
    request: Schema.Types.Mixed,
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    result: { type: String, enum: AUDIT_RESULTS, required: true },
    reason: String,
    requestId: String,
  },
  options: {
    timestamps: true,
  },
  callback: (schema) => {
    schema.index({ createdAt: 1 }, { expireAfterSeconds: auditRetentionDays * 24 * 60 * 60 })
    schema.index({ actor: 1, createdAt: -1 })
    schema.index({ 'target.id': 1, createdAt: -1 })
    schema.index({ action: 1, createdAt: -1 })
    return schema
  },
})
