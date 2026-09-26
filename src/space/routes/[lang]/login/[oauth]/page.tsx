import type { PageActionContext, PageContext } from '@zanix/space'

import { Guard } from '@zanix/server'
import { csrfGuard, Page, SpacePageController } from '@zanix/space'
import { HttpError } from '@zanix/errors'
import { OauthStartView } from 'ui/pages/login-oauth-start/index.ts'
import type { OauthStartViewProps } from 'ui/pages/login-oauth-start/index.ts'
import { OAUTH_STATE_LOCALS_KEY, oauthStateIssueGuard, rateLimitGuard } from '@zanix/auth'
import { AuthService } from 'server/interactors/auth.interactor.ts'
import { criticalRateLimit, OAUTH_PROVIDERS } from 'utils/constants.ts'

type OauthParams = { lang: string; oauth: string }

/**
 * Starts the OAuth2 flow for `:oauth` (e.g. `google`) — an intermediate confirmation screen, not an
 * immediate GET redirect — an architectural constraint, not a UX preference:
 * `SpacePageController`'s own `static redirect` target (`RedirectConfig.to`) is a fixed string
 * resolved once at class-definition time, and a page's `loader`/`GET` has no mechanism to produce a
 * dynamically COMPUTED `Response` (`handleGet`'s only non-render exits are that static `redirect`
 * or a `304`) — only `action` (`POST`) can return an arbitrary
 * `Response`. The provider's real authorization URL is only known once `AuthService.loginWithOauth`
 * actually runs, which cannot happen before this page's own `GET`, so the redirect itself has to
 * happen from a `POST` this page's `component` renders as a real, CSRF-protected form.
 *
 * `oauth` is validated against `OAUTH_PROVIDERS` in `loader` — an unsupported value (never one this
 * app itself links to, only a hand-typed/stale URL) renders the whole-app not-found view via the
 * thrown `HttpError('NOT_FOUND')`, the same recovery `handleGet` already gives any other thrown
 * `loader` error.
 */
// This page's own `action` calls `AuthService.loginWithOauth` directly (an
// in-process interactor call), so `LoginController.oAuth`'s own `@RateLimitGuard` (`login.handler.ts`)
// never runs for a visitor reaching this route. A distinct `app` key (`login:oauth-page`) keeps
// its own bucket, isolated from the REST endpoint's own.
@Page({ Interactor: AuthService })
@Guard(csrfGuard())
@Guard(oauthStateIssueGuard())
@Guard(
  rateLimitGuard({
    app: 'login:oauth-page',
    anonymousLimit: criticalRateLimit,
    trustProxyHeader: true,
  }),
)
export default class LoginOauthStartPage extends SpacePageController<OauthParams, AuthService> {
  public static override head = { title: 'Continue with OAuth2' }

  public override component = OauthStartView

  public override loader = (ctx: PageContext<OauthParams>): OauthStartViewProps => {
    const { lang, oauth } = ctx.params
    if (!OAUTH_PROVIDERS.includes(oauth as OauthProviders)) {
      throw new HttpError('NOT_FOUND', { message: `Unknown OAuth2 provider "${oauth}".` })
    }
    return { lang, oauth, csrfToken: ctx.csrfToken }
  }

  public override action = (ctx: PageActionContext<OauthParams>): Promise<Response> => {
    // `oauthStateIssueGuard` (applied above, `@zanix/auth`) already ran ahead of this
    // `action` and stashed a fresh `state` value here — the SAME value it also persisted as a
    // short-lived cookie. Passing it into `loginWithOauth` (rather than letting
    // `generateAuthUrl()` mint its own random one) is what lets the callback leg
    // (`oauthStateVerifyGuard`) later confirm the provider's own `?state=...` redirect matches
    // what THIS project actually started, closing the classic OAuth2 CSRF this flow would
    // otherwise be open to.
    const state = ctx.locals[OAUTH_STATE_LOCALS_KEY] as string | undefined
    const { url } = this.interactor.loginWithOauth(ctx.params.oauth as OauthProviders, state)
    return Promise.resolve(Response.redirect(url, 302))
  }
}
