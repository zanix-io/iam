import { Controller, Get, type HandlerContext, Post, ZanixController } from '@zanix/server'
import { RateLimitGuard } from '@zanix/auth'
import { OAuthAuthorizeRTO, OAuthTokenExchangeRTO } from './rtos/oauth-provider.ts'
import { OAuthProviderService } from '../interactors/oauth-provider.interactor.ts'
import { criticalRateLimit, freeRateLimit } from 'utils/constants.ts'

/**
 * OAuth2/OIDC-style PROVIDER endpoints for the `oauth-provider` domain — this project acting
 * as the authorization server for a HOST application, the opposite role from `LoginController`'s
 * own `:oauth`/`:oauth/callback` routes (this project as a CLIENT of Google/GitHub). A host redirects
 * an end user here with its own registered `client_id`/`redirect_uri`, this project's real hosted
 * login flow authenticates them, and the host's own BACKEND later exchanges the resulting code for a
 * session via `token`.
 *
 * Same anonymous-rate-limiting caveat as `LoginController`/`PasswordController`: keyed off the
 * client IP resolved from proxy-forwarded headers (`trustProxyHeader: true`), correct only behind a
 * trusted reverse proxy — see either controller's own header doc.
 */
@Controller({ prefix: 'oauth', Interactor: OAuthProviderService })
export class OAuthProviderController extends ZanixController<OAuthProviderService> {
  /**
   * Starts the flow: validates `client_id`/`redirect_uri`, then either redirects straight to
   * `redirect_uri` with a freshly minted code (an active iam session already exists) or bounces the
   * browser through the real hosted login page first. See `OAuthProviderService.authorize`'s own
   * doc for the full mechanism and its documented trade-offs.
   */
  @Get('authorize', { Search: OAuthAuthorizeRTO })
  @RateLimitGuard({ anonymousLimit: criticalRateLimit, trustProxyHeader: true })
  public authorize(ctx: HandlerContext<{ search: OAuthAuthorizeRTO }>) {
    return this.interactor.authorize(ctx.payload.search)
  }

  /**
   * Exchanges a code minted by `authorize` for a real session — called by the requesting host's own
   * backend, never a browser (see `OAuthProviderService.exchangeCode`'s own doc for the trust/
   * response-shape reasoning).
   */
  @Post('token', { Body: OAuthTokenExchangeRTO })
  @RateLimitGuard({ anonymousLimit: freeRateLimit, trustProxyHeader: true })
  public token(ctx: HandlerContext<{ body: OAuthTokenExchangeRTO }>) {
    return this.interactor.exchangeCode(ctx.payload.body)
  }
}
