import type { PageActionContext, PageContext } from '@zanix/space'

import { Guard } from '@zanix/server'
import { csrfGuard, Page, SpacePageController } from '@zanix/space'
import { HttpError } from '@zanix/errors'
import { Button } from '@zanix/space-ui'
import { OAUTH_STATE_LOCALS_KEY, oauthStateIssueGuard } from '@zanix/auth'
// A NAMED import — `@zanix/space/comet/react` carries more than one ready-made Comet, so (unlike
// this project's own former `submit-guard.comet.tsx`) there's no single default. No draft
// persistence here — this form carries no real field to recover, just a hidden CSRF token and a
// single confirm button.
import { SubmitGuard } from '@zanix/space/comet/react'
import { AuthService } from '../../../../../server/interactors/auth.interactor.ts'
import { OAUTH_PROVIDERS } from '../../../../../utils/constants.ts'

type OauthParams = { lang: string; oauth: string }

type OauthViewProps = { lang: string; oauth: string; csrfToken?: string }

/** This page's own `<form>` id — `SubmitGuard`'s own `formId` target. */
const FORM_ID = 'login-oauth-form'

function OauthStartView({ lang, oauth, csrfToken }: OauthViewProps) {
  return (
    <main>
      <h1>Continue with {oauth}</h1>
      <SubmitGuard formId={FORM_ID} />
      <form method='post' id={FORM_ID}>
        <input type='hidden' name='_csrf' value={csrfToken ?? ''} />
        <Button type='submit'>Continue with {oauth}</Button>
      </form>
      <p>
        <a href={`/${lang}/login`}>Back to sign in</a>
      </p>
    </main>
  )
}

/**
 * Starts the OAuth2 flow for `:oauth` (e.g. `google`) — an intermediate confirmation screen, not an
 * immediate GET redirect. This is a real architectural constraint, not a UX preference:
 * `SpacePageController`'s own `static redirect` target (`RedirectConfig.to`) is a fixed string
 * resolved once at class-definition time, and a page's `loader`/`GET` has no mechanism to produce a
 * dynamically COMPUTED `Response` (`handleGet`'s only non-render exits are that static `redirect`
 * or a `304`, confirmed by reading its own source) — only `action` (`POST`) can return an arbitrary
 * `Response`. The provider's real authorization URL is only known once `AuthService.loginWithOauth`
 * actually runs, which cannot happen before this page's own `GET`, so the redirect itself has to
 * happen from a `POST` this page's `component` renders as a real, CSRF-protected form.
 *
 * `oauth` is validated against `OAUTH_PROVIDERS` in `loader` — an unsupported value (never one this
 * app itself links to, only a hand-typed/stale URL) renders the whole-app not-found view via the
 * thrown `HttpError('NOT_FOUND')`, the same recovery `handleGet` already gives any other thrown
 * `loader` error.
 */
@Page({ Interactor: AuthService })
@Guard(csrfGuard())
@Guard(oauthStateIssueGuard())
export default class LoginOauthStartPage extends SpacePageController<OauthParams, AuthService> {
  public static override head = { title: 'Continue with OAuth2' }

  public override component = OauthStartView

  public override loader = (ctx: PageContext<OauthParams>): OauthViewProps => {
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
