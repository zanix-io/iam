import type { PageContext } from '@zanix/space'

import { Guard } from '@zanix/server'
import { Page, SpacePageController } from '@zanix/space'
import { OauthCallbackView } from 'ui/pages/login-oauth-callback/index.ts'
import type { OauthCallbackViewProps } from 'ui/pages/login-oauth-callback/index.ts'
import { HttpError } from '@zanix/errors'
import { oauthStateVerifyGuard, rateLimitGuard } from '@zanix/auth'
import { AuthService } from 'server/interactors/auth.interactor.ts'
import { freeRateLimit, OAUTH_PROVIDERS } from 'utils/constants.ts'

type CallbackParams = { lang: string; oauth: string }

/**
 * Completes the OAuth2 flow for `:oauth`: the provider's own redirect delivers the authorization
 * `code` via a plain `GET` query string (`?code=...`, per the OAuth2 code-flow spec) — there is no
 * `POST` involved at all on this leg, unlike `../page.tsx`'s own start step. That forces the token
 * exchange (`AuthService.loginWithOauthCallback`) to run from `loader`, not `action`, even though
 * it's a real, one-time-use, state-changing call — the one page in this feature where that's true.
 *
 * **Why this is still safe, unlike a page mutating state from `loader` in general**: the session
 * this call issues is written through `ZanixAuthProvider`'s own request-scoped context (the SAME
 * mechanism `../page.tsx` and every other login page in this feature already rely on — see that
 * file's own doc) — `contextSettingPipe` populates it before ANY handler runs, `GET` included, so
 * `sessionHeadersInterceptor` still attaches the resulting `Set-Cookie` onto whatever response this
 * `GET` produces, a full-document render exactly as it would a redirect. No `PageActionContext`/
 * `.locals` access is needed here — `AuthService` never takes an explicit `ctx`.
 *
 * A thrown error (invalid/expired `code`, an unverified provider email, an account already linked
 * to a different sign-in method, or a missing/mismatched `state` — see
 * `AuthService.loginWithOauthCallback`'s own doc, and `oauthStateVerifyGuard` below, for each) is
 * left to `handleGet`'s own recovery path: this route's nearest `error.tsx` (see the sibling
 * `error.tsx` in this same directory) rather than a PRG back to a form, since there is no form here
 * to PRG back to — the user never submitted anything themselves on this leg, the provider did.
 *
 * `@Guard(oauthStateVerifyGuard())` runs before `loader` above and rejects a missing/mismatched
 * `state` outright — see `@zanix/auth`'s own export for the full round trip (this page's own
 * sibling `../page.tsx` is where the SAME value is minted and persisted).
 */
// This page's own `loader` calls `AuthService.loginWithOauthCallback` directly
// (an in-process interactor call), so `LoginController.oAuthLogin`'s own `@RateLimitGuard`
// (`login.handler.ts`) never runs for a visitor reaching this route. A distinct `app` key
// (`login:oauth-callback-page`) keeps its own bucket, isolated from the REST endpoint's own.
@Page({ Interactor: AuthService })
@Guard(oauthStateVerifyGuard())
@Guard(
  rateLimitGuard(
    { app: 'login:oauth-callback-page', anonymousLimit: freeRateLimit, trustProxyHeader: true },
  ),
)
export default class LoginOauthCallbackPage
  extends SpacePageController<CallbackParams, AuthService> {
  public static override head = { title: 'Signed in' }

  public override component = OauthCallbackView

  public override loader = async (
    ctx: PageContext<CallbackParams>,
  ): Promise<OauthCallbackViewProps> => {
    const { lang, oauth } = ctx.params
    if (!OAUTH_PROVIDERS.includes(oauth as OauthProviders)) {
      throw new HttpError('NOT_FOUND', { message: `Unknown OAuth2 provider "${oauth}".` })
    }

    const code = ctx.url.searchParams.get('code')
    if (!code) {
      throw new HttpError('BAD_REQUEST', { message: 'Missing authorization code.' })
    }

    const result = await this.interactor.loginWithOauthCallback(code, oauth as OauthProviders)
    // The linked `users` profile is `'INACTIVE'` — withheld tokens on purpose instead of
    // reactivating silently (see `challengeReactivation`'s own doc). No session cookie was
    // attached for this request; send the visitor to a real confirmation screen instead of the
    // normal "you're signed in" destination.
    if ('needsReactivationConfirm' in result) {
      return { redirectTo: `/${lang}/login/reactivate/${result.reactivationToken}` }
    }
    // The account requires a second factor: no session was issued yet, so continue at that step.
    if ('method' in result && result.email) {
      const step = result.method === 'totp' ? 'totp' : 'otp'
      return { redirectTo: `/${lang}/login/${step}/${encodeURIComponent(result.email)}` }
    }
    return {}
  }
}
