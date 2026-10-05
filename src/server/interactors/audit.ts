import type { AuditEventAttrs } from '../repositories/audit/model.defs.ts'
import type { Providers } from 'utils/rbac.ts'
import type { Session } from '@zanix/server'

import { HttpError } from '@zanix/errors'
import { AuditRepository } from '../repositories/audit/entity.provider.ts'

/** What an audited operation is, known before it runs. */
export type AuditedOperation = {
  /** `<domain>.<operation>`, e.g. `roles.add`. */
  action: string
  target: AuditEventAttrs['target']
  /** What the request asks for, as ids and plain values only. */
  request?: unknown
}

/** What the operation may add while it runs, once it knows it. */
export type AuditNote = (
  details: { before?: unknown; after?: unknown; targetId?: string },
) => void

/** The result an HTTP status closes an audit event with. */
function resultOf(error: unknown): { result: AuditEventAttrs['result']; reason: string } {
  const status = error instanceof HttpError ? error.status : undefined
  const reason = (error as { code?: string })?.code ?? status?.code ?? 'UNKNOWN'
  if (status?.value === 403) return { result: 'denied', reason }
  if (status?.value === 409) return { result: 'conflict', reason }
  return { result: 'error', reason }
}

/**
 * Runs `run` recording it in the audit trail: an event is written as `pending` BEFORE anything
 * changes, so no change is left without a trace even if the process stops midway, and is closed
 * with the outcome afterwards — `ok`, or `denied`/`conflict`/`error` with the rejection's stable
 * `code` as the reason. Rejections by the security rules are recorded like successes.
 *
 * The trail fails closed: if the `pending` event cannot be written, `run` does not run and the
 * request fails. Closing the event is best effort; a failure there is logged and the operation's
 * own outcome stands (the event stays `pending`, which still evidences the attempt).
 */
export async function audited<T>(
  providers: Providers,
  context: { id: string; session?: Session },
  operation: AuditedOperation,
  run: (note: AuditNote) => Promise<T>,
): Promise<T> {
  const repository = providers.get(AuditRepository)
  const { session } = context
  const eventId = await repository.begin({
    actor: session?.subject ? String(session.subject) : session?.id,
    actorType: session?.type,
    action: operation.action,
    target: operation.target,
    request: operation.request,
    requestId: context.id,
  })

  let details: Parameters<AuditNote>[0] = {}
  const close = async (result: AuditEventAttrs['result'], reason?: string) => {
    try {
      await repository.finish(eventId, result, { reason, ...details })
    } catch (cause) {
      new HttpError('INTERNAL_SERVER_ERROR', {
        message: `Could not close audit event ${eventId}.`,
        cause,
        shouldLog: true,
      })
    }
  }

  try {
    const output = await run((noted) => details = { ...details, ...noted })
    await close('ok')
    return output
  } catch (error) {
    const { result, reason } = resultOf(error)
    await close(result, reason)
    throw error
  }
}
