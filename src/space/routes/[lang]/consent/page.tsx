import type { PageActionContext } from '@zanix/space'

import { Page, SpacePageController } from '@zanix/space'
import { ConsentView } from 'ui/pages/consent/index.ts'
import { SESSION_COOKIE_ATTRIBUTES } from '@zanix/helpers'
import { ConsentRTO } from 'server/handlers/rtos/consent.ts'
import { COOKIES_ACCEPTED_COOKIE } from 'utils/cookie-consent.ts'

type ConsentParams = { lang: string }

/**
 * How long a recorded cookie-consent decision (Accept OR Decline) stays valid before
 * `../../../comets/cookie-consent-modal.comet.tsx` prompts again — 1 year, independent of, and
 * always longer than, any real session's own lifetime (`getSessionHeaders`'s own
 * `refreshToken`-derived `Max-Age`, `@zanix/auth`), so this decision never expires out from under a
 * still-alive session the way that function's own doc warns against for the OPPOSITE direction.
 */
const CONSENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/**
 * The one endpoint this project's cookie-consent gate needs — see
 * `../../../comets/cookie-consent-modal.comet.tsx`'s own doc for the full round trip, and
 * `../layout.tsx`'s own doc for why this is a single, project-wide gate rather than one
 * special-cased per login/OTP/TOTP/recovery/OAuth2 flow.
 *
 * A Space page action, deliberately, NOT a REST handler (`@zanix/server` `Controller`): this
 * project's own REST handlers (`login.handler.ts`/`password.handler.ts`/...) are auto-discovered
 * only by `mod.ts`'s own `Zanix.start()` call, which `zanix space dev` never runs, so a REST-shaped
 * consent endpoint would be unreachable under `zanix space dev`. A Space page action is served
 * identically under both `zanix space dev` and production `mod.ts`.
 *
 * No `csrfGuard()` — a low-stakes action: the worst a forged cross-site `POST` here can do is record a consent decision
 * the operator didn't actually make — a real but low-severity, bounded concern (a false "declined"
 * fails safe, emitting no session cookies at all; a false "accepted" only permits a LATER,
 * otherwise-legitimate login to emit real session cookies, which still requires the genuine account
 * credential itself), not a session/data-exposure vector `csrfGuard`'s own double-submit-cookie
 * mechanism exists to close.
 */
@Page({ action: { Body: ConsentRTO } })
export default class ConsentPage extends SpacePageController<ConsentParams> {
  public static override head = { title: 'Cookie consent' }

  public override component = ConsentView

  /**
   * Attaches the real, initial `${COOKIES_ACCEPTED_COOKIE}` cookie directly — no session exists
   * yet for `sessionHeadersInterceptor` (`@zanix/auth`) to re-assert it alongside, so this is the
   * one place in this project that plants it for the first time. Same
   * `Path=/; HttpOnly; Secure; SameSite=Strict` attributes `@zanix/helpers`'s own
   * `SESSION_COOKIE_ATTRIBUTES` gives every session-related cookie here — `HttpOnly` is safe
   * specifically because nothing ever needs to read this cookie's value from client-side JS: the
   * consent modal's own initial open/closed state is computed SERVER-SIDE (`../layout.tsx`'s own
   * `loader`, via `hasCookieConsentDecision`) and handed down as a plain prop.
   *
   * `204 No Content`, not a redirect/rendered page — the modal's own `fetch()` call reads only
   * `response.ok`, never a body or a `Location`; there is nothing to render or navigate to.
   */
  public override action = (ctx: PageActionContext<ConsentParams>): Promise<Response> => {
    const { accepted } = ctx.body as ConsentRTO

    return Promise.resolve(
      new Response(null, {
        status: 204,
        headers: {
          'Set-Cookie':
            `${COOKIES_ACCEPTED_COOKIE}=${accepted}; Max-Age=${CONSENT_COOKIE_MAX_AGE}; ` +
            SESSION_COOKIE_ATTRIBUTES,
        },
      }),
    )
  }
}
