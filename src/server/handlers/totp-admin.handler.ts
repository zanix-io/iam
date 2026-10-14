import { Controller, Get, type HandlerContext, Post, ZanixController } from '@zanix/server'
import { AuthTokenValidation } from '@zanix/auth'
import { SearchTotpResetsRTO, TotpResetRTO } from './rtos/totp-admin.ts'
import { TotpAdminService } from '../interactors/totp-admin.interactor.ts'
import { RBAC_PERMISSIONS } from 'utils/constants.ts'
import { AdminMutationRateLimit } from 'utils/admin-rate-limit.ts'

/**
 * Operator endpoints for the authenticator app of an account. Both routes need
 * `RBAC_PERMISSIONS.totpReset`, a permission of its own so support staff can hold it without
 * managing roles or users.
 */
@Controller({ prefix: 'admin/totp', Interactor: TotpAdminService })
export class TotpAdminController extends ZanixController<TotpAdminService> {
  /**
   * Removes the authenticator app and the backup codes of `authId` (the person lost their
   * authenticator) — see `TotpAdminService.resetTotp`. The reason travels in the body, and the
   * reset is audited.
   */
  @Post('reset', { Body: TotpResetRTO })
  @AdminMutationRateLimit()
  @AuthTokenValidation({ permissions: RBAC_PERMISSIONS.totpReset })
  public reset(ctx: HandlerContext<{ body: TotpResetRTO }>) {
    const { authId, reason } = ctx.payload.body
    return this.interactor.resetTotp(authId, reason)
  }

  /** One page of the recorded resets, newest first (`authId` narrows it to one account). */
  @Get('resets', { Search: SearchTotpResetsRTO })
  @AuthTokenValidation({ permissions: RBAC_PERMISSIONS.totpReset })
  public resets(ctx: HandlerContext<{ search: SearchTotpResetsRTO }>) {
    const { authId, page, limit } = ctx.payload.search
    return this.interactor.listResets({ authId, page, limit })
  }
}
