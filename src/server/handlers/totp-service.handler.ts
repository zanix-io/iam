import { Controller, Get, type HandlerContext, Post, ZanixController } from '@zanix/server'
import { AuthTokenValidation, RateLimitGuard } from '@zanix/auth'
import {
  SearchTotpResetsRTO,
  ServiceLookupAccountRTO,
  ServiceTokenRTO,
  ServiceTotpResetRTO,
} from './rtos/totp-admin.ts'
import { TotpAdminService } from '../interactors/totp-admin.interactor.ts'
import { criticalRateLimit } from 'utils/constants.ts'
import { AdminLookupRateLimit, AdminMutationRateLimit } from 'utils/admin-rate-limit.ts'

/**
 * Endpoints for a trusted service that acts on behalf of an operator it authenticated itself, for
 * the case where the operators live in another identity directory than the accounts they help (a
 * staff `iam` for the people of the main one). The caller is a service credential, never a user
 * token: it signs an assertion with its own key (`JWK_PUB_<serviceId>` registered here), exchanges
 * it at `token`, and sends the resulting token in `X-Znx-Authorization`. Only the services listed
 * in `IAM_TOTP_RESET_SERVICES` are served; with the variable unset every call is refused.
 *
 * The routes accept either kind of token at the guard so that a user token is answered `403`
 * (`SERVICE_CREDENTIAL_REQUIRED`) by the interactor instead of an ambiguous `401`.
 */
@Controller({ prefix: 'admin/service', Interactor: TotpAdminService })
export class TotpServiceController extends ZanixController<TotpAdminService> {
  /**
   * Exchanges the assertion of a listed service for an `api` access token. Public by design, like
   * every credential exchange: trust comes from the signature check against the service's key.
   */
  @Post('token', { Body: ServiceTokenRTO })
  @RateLimitGuard({
    app: 'service:token',
    anonymousLimit: criticalRateLimit,
    trustProxyHeader: true,
  })
  public token(ctx: HandlerContext<{ body: ServiceTokenRTO }>) {
    return this.interactor.exchangeServiceToken(ctx.payload.body.assertion)
  }

  /**
   * Finds the account with exactly the `email` of the body (never a URL) and answers `authId`,
   * `userId`, `status`, `hasTotp` and `backupCodesRemaining`. See
   * `TotpAdminService.lookupAccountForService`.
   */
  @Post('accounts/lookup', { Body: ServiceLookupAccountRTO })
  @AdminLookupRateLimit()
  @AuthTokenValidation({ type: ['user', 'api'] })
  public lookup(ctx: HandlerContext<{ body: ServiceLookupAccountRTO }>) {
    return this.interactor.lookupAccountForService(ctx.payload.body.email)
  }

  /** Removes the authenticator app and backup codes of `authId` for the operator the service
   * vouches for. See `TotpAdminService.resetTotpForService`. */
  @Post('totp/reset', { Body: ServiceTotpResetRTO })
  @AdminMutationRateLimit()
  @AuthTokenValidation({ type: ['user', 'api'] })
  public reset(ctx: HandlerContext<{ body: ServiceTotpResetRTO }>) {
    const { authId, reason, operator } = ctx.payload.body
    return this.interactor.resetTotpForService(authId, reason, operator.id)
  }

  /** One page of the recorded resets, newest first (`authId` narrows it to one account). */
  @Get('totp/resets', { Search: SearchTotpResetsRTO })
  @AuthTokenValidation({ type: ['user', 'api'] })
  public resets(ctx: HandlerContext<{ search: SearchTotpResetsRTO }>) {
    const { authId, page, limit } = ctx.payload.search
    return this.interactor.listResetsForService({ authId, page, limit })
  }
}
