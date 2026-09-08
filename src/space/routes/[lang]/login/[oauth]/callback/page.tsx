import type { PageContext } from '@zanix/space'

import { Guard } from '@zanix/server'
import { Page, SpacePageController } from '@zanix/space'
import { HttpError } from '@zanix/errors'
import { oauthStateVerifyGuard } from '@zanix/auth'
import { AuthService } from '../../../../../../server/interactors/auth.interactor.ts'
import { OAUTH_PROVIDERS } from '../../../../../../utils/constants.ts'

type CallbackParams = { lang: string; oauth: string }

/**
 * A minimal "you're signed in" interstitial — the actual session cookie is already attached to
 * THIS SAME response by the time this renders (see this class's own doc for why), so all this view
 * needs to do is get the browser to its next real page. `<meta http-equiv="refresh">` works with
 * scripting disabled, unlike a `window.location` redirect; the `<a>` is the no-JS/no-meta-refresh
 * fallback. Redirects to the plain, unprefixed `/` — same interim landing target as `../page.tsx`'s
 * own doc explains (no dashboard/account page exists yet).
 */
function OauthCallbackView() {
  return (
    <main>
      <meta httpEquiv='refresh' content={`0;url=/`} />
      <h1>Signed in</h1>
      <p>
        <a href='/'>Continue</a>
      </p>
    </main>
  )
}

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
 * `.locals` access is needed here at all — this project's own `AuthService` never required threading
 * an explicit `ctx` the way `console`'s bespoke `LoginInteractor` did.
 *
 * A thrown error (invalid/expired `code`, an unverified provider email, an account already linked
 * to a different sign-in method, or a missing/mismatched `state` — see
 * `AuthService.loginWithOauthCallback`'s own doc, and `oauthStateVerifyGuard` below, for each) is
 * left to `handleGet`'s own recovery path: this route's nearest `error.tsx` (see the sibling
 * `error.tsx` in this same directory) rather than a PRG back to a form, since there is no form here
 * to PRG back to — the user never submitted anything themselves on this leg, the provider did.
 *
 * `@Guard(oauthStateVerifyGuard())` runs before `loader` above and rejects a missing/mismatched
 * `state` outright — see `@zanix/auth`'s own export for the full round trip this closes (this
 * page's own sibling `../page.tsx` is where the SAME value is originally minted and persisted).
 */
@Page({ Interactor: AuthService })
@Guard(oauthStateVerifyGuard())
export default class LoginOauthCallbackPage
  extends SpacePageController<CallbackParams, AuthService> {
  public static override head = { title: 'Signed in' }

  public override component = OauthCallbackView

  public override loader = async (ctx: PageContext<CallbackParams>): Promise<void> => {
    const { oauth } = ctx.params
    if (!OAUTH_PROVIDERS.includes(oauth as OauthProviders)) {
      throw new HttpError('NOT_FOUND', { message: `Unknown OAuth2 provider "${oauth}".` })
    }

    const code = ctx.url.searchParams.get('code')
    if (!code) {
      throw new HttpError('BAD_REQUEST', { message: 'Missing authorization code.' })
    }

    await this.interactor.loginWithOauthCallback(code, oauth as OauthProviders)
  }
}
