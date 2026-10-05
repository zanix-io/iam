import { Controller, Get, type HandlerContext, ZanixController } from '@zanix/server'
import { AuthTokenValidation } from '@zanix/auth'
import { SearchAuditRTO } from './rtos/audit.ts'
import { AuditService } from '../interactors/audit.interactor.ts'
import { RBAC_PERMISSIONS } from 'utils/constants.ts'

/** The audit trail of role, permission and account-status changes. Read-only, `audit-read`. */
@Controller({ prefix: 'audit', Interactor: AuditService })
export class AuditController extends ZanixController<AuditService> {
  /** Paginated, filterable listing of audit events, newest first. */
  @Get('', { Search: SearchAuditRTO })
  @AuthTokenValidation({ permissions: RBAC_PERMISSIONS.auditRead })
  public search(ctx: HandlerContext<{ search: SearchAuditRTO }>) {
    return this.interactor.searchEvents(ctx.payload.search)
  }
}
