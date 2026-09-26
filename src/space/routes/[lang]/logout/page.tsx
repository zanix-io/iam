import type { PageActionContext } from '@zanix/space'

import { Page, SpacePageController } from '@zanix/space'
import { LogoutView } from 'ui/pages/logout/index.ts'
import { AuthService } from 'server/interactors/auth.interactor.ts'
import { redirectResponse } from 'shared/redirect-response.ts'

type LogoutParams = { lang: string }

/**
 * Ends the current session — binds to `AuthService` and calls `AuthService.revokeToken` from a plain
 * `action`, no Guard-stage composition needed.
 *
 * `token` is omitted from `revokeToken(token)`: the underlying `revokeSessionTokenBase`
 * falls back to `ctx.cookies[tokenHeader]` on its own, and `ctx.cookies` is a plain, always-present
 * `HandlerContext` field (unlike `.locals`/`.session`, which only exist post-pipe) — available
 * here regardless.
 *
 * No manual `Set-Cookie`: `sessionHeadersInterceptor` (`@zanix/auth`) clears the session cookies
 * itself — `getSessionHeaders` ties their `Max-Age` to the REFRESH token's lifetime, so clearing
 * works for any live session.
 *
 * No `csrfGuard()`: `@zanix/auth`'s session cookies default to `SameSite=Strict` already, which a
 * cross-site form POST can't attach at all.
 *
 * Renders `@zanix/iam/ui/pages/logout`'s own factory-built view (`createElement`-based, never
 * JSX).
 */
@Page({ Interactor: AuthService })
export default class LogoutPage extends SpacePageController<LogoutParams, AuthService> {
  public static override head = { title: 'Sign out' }

  public override component = LogoutView

  public override action = async (ctx: PageActionContext<LogoutParams>): Promise<Response> => {
    await this.interactor.revokeToken()
    return redirectResponse(`/${ctx.params.lang}/login`)
  }
}
