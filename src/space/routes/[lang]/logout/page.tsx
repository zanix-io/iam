import type { PageActionContext } from '@zanix/space'

import { Page, SpacePageController } from '@zanix/space'
import { LogoutView } from 'ui/pages/logout/index.ts'
import { AuthService } from 'server/interactors/auth.interactor.ts'
import { redirectResponse } from 'shared/redirect-response.ts'

type LogoutParams = { lang: string }

/**
 * Ends the current session. This project OWNS a real, already-tested `AuthService.revokeToken`
 * interactor method — unlike `console`, which had no interactor-level revoke of its own
 * and had to compose `@zanix/auth`'s raw `revokeSessionToken` free function directly inside a
 * bespoke `Guard` (`endSession()`, `auth/guards.ts`) — so this page just binds to `AuthService` and
 * calls it from a plain `action`, no Guard-stage composition needed.
 *
 * `token` is omitted from `revokeToken(token)` — same reasoning `console`'s own
 * `endSession()` doc gives for its identical omission: the underlying `revokeSessionTokenBase`
 * falls back to `ctx.cookies[tokenHeader]` on its own, and `ctx.cookies` is a plain, always-present
 * `HandlerContext` field (unlike `.locals`/`.session`, which only exist post-pipe) — available
 * here regardless.
 *
 * **No manual `Set-Cookie` workaround, deliberately** — `console`'s own `logout/page.tsx`
 * needed one for a real, confirmed `@zanix/auth` bug: `getSessionHeaders` tied the cookie-consent/
 * session-status cookies' `Max-Age` to the ACCESS token's short (~1h) expiration instead of the
 * REFRESH token's ~1-year one, silently breaking `sessionHeadersInterceptor`'s own cookie-clearing
 * for any session older than that window. That fix is confirmed present in `getSessionHeaders`
 * (`@zanix/auth`, `src/utils/sessions/headers.ts`) as linked into THIS project today — copying the
 * workaround here would be carrying over a bug that no longer exists in this project's own
 * dependency, not real defense-in-depth.
 *
 * No `csrfGuard()`, matching `console`'s own identical reasoning for the same page:
 * `@zanix/auth`'s session cookies default to `SameSite=Strict` already, which a cross-site form
 * POST can't attach at all — `csrfGuard` would be defense-in-depth this page doesn't need any more
 * than that reference does.
 *
 * Rendering now delegates to `@zanix/iam/ui/pages/logout`'s own factory-built view
 * (`createElement`-based, never JSX) — the `action` below is unchanged.
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
