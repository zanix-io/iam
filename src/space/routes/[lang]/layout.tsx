import type { LayoutProps, PageContext, SpaceChildren } from '@zanix/space'

// A RELATIVE path, deliberately — every page/layout under `routesDir` needs this: `zanix space
// dev`'s own route-discovery step resolves a file under `routesDir`'s bare specifiers against
// `@zanix/cli`'s OWN configuration, never this project's (see `login/page.tsx`'s own identical doc
// for the full, confirmed reasoning). No import-map entry needed for a relative path.
import { hasCookieConsentDecision } from '../../../utils/cookie-consent.ts'
import { isCookieConsentEnabled } from '../../../utils/constants.ts'
import CookieConsentModal from '../../comets/cookie-consent-modal.comet.tsx'

/** This segment's own `Params` shape — the one dynamic route param every page under it inherits. */
type LangParams = { lang: string }

/** This layout's own resolved `loader` data — `LangParams` plus what
 * {@linkcode CookieConsentModal} needs to render correctly from the very first byte. */
type LangLayoutData = LangParams & {
  /** Whether this request's own `Cookie` header already carries a RECORDED cookie-consent decision
   * — see `utils/cookie-consent.ts`'s own `hasCookieConsentDecision` doc for why this is broader
   * than "cookies accepted". */
  cookiesDecided: boolean
  /** This request's own CSP nonce — see {@linkcode CookieConsentModal}'s own `cspNonce` prop doc. */
  cspNonce?: string
}

/** Resolves this layout's own {@linkcode LangLayoutData} for every page under `[lang]/`. */
export const loader = (ctx: PageContext<LangParams>): LangLayoutData => ({
  lang: ctx.params.lang,
  cookiesDecided: hasCookieConsentDecision(ctx.request.headers.get('cookie')),
  cspNonce: ctx.cspNonce,
})

/**
 * This project's own root document shell — the actual `<html>`/`<body>` for every real page, since
 * every one of them lives under this `[lang]/...` segment (see `middleware.ts`'s own doc for the
 * `langPreHandler`/`langGuard` wiring that gets a request here at all). No `routes/layout.tsx`
 * above this one: with no root layout at all, `SpacePageController` already wraps anything OUTSIDE
 * this segment (only the whole-app `not-found.tsx`, which `langPreHandler` never redirects to) in a
 * minimal, spec-valid default document — a second, `<html>`-less root layout here would only
 * duplicate that for no benefit.
 *
 * `lang` comes from this segment's own `loader` (`ctx.params.lang`) — never hardcoded — so the
 * document's own `lang` attribute always matches the resolved `/{lang}/...` prefix. `data` is
 * `LayoutProps`'s own non-optional field — this segment's `loader` above always runs ahead of any
 * real render reaching this layout, so it's never actually `undefined` here in practice.
 *
 * {@linkcode CookieConsentModal} is composed HERE, once, project-wide — not per login/OTP/TOTP/
 * password-recovery/OAuth2 page. Real, confirmed bug this closes: `@zanix/auth`'s own
 * `checkAcceptedCookies` defaults to `false` unless a request already carries an accepted-cookies
 * signal, so with no consent mechanism at all, `sessionHeadersInterceptor` never emitted ANY session
 * `Set-Cookie` on a real login — the login itself succeeded (correct response headers, correct
 * redirect), but no session ever actually persisted in the browser.
 *
 * This project diverges from `@zanix/console`'s own reference (a per-login-form dialog whose
 * "Accept" flow attaches `X-Znx-Cookies-Accepted: true` as a real header on that ONE form's own
 * `fetch()`-driven submit) because this project has SEVERAL session-issuing entry points, one of
 * which — `login/[oauth]/callback/page.tsx` — mints a session from a plain `GET` the OAuth2
 * provider's own browser redirect delivers, with no form for a per-form interception trick to
 * attach to at all. A single, project-wide gate shown before the user ever reaches ANY of those
 * flows (this layout wraps every one of them) persists the decision as a real cookie
 * (`./consent/page.tsx`) BEFORE that point is ever reached, so
 * `checkAcceptedCookies`'s own cookie fallback picks it up uniformly for every later request,
 * OAuth2's plain `GET` included — with no per-form special-casing anywhere.
 *
 * {@linkcode CookieConsentModal} only mounts while `isCookieConsentEnabled()`
 * (`utils/constants.ts`'s own `COOKIE_CONSENT_ENABLED_ENV`) says so — the default. A deployment
 * that turns it off relies on `space/middleware.ts`'s own `cookieConsentBypassGuard` instead to
 * keep `checkAcceptedCookies` resolving `true` on every request, so session cookies are still
 * emitted with no modal ever shown.
 */
export default function LangLayout(
  { children, data }: LayoutProps<SpaceChildren, LangLayoutData>,
) {
  return (
    <html lang={data.lang}>
      <head>
        <meta charSet='utf-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1' />
      </head>
      <body>
        {isCookieConsentEnabled() && (
          <CookieConsentModal
            lang={data.lang}
            initialDecided={data.cookiesDecided}
            cspNonce={data.cspNonce}
          />
        )}
        {children}
      </body>
    </html>
  )
}
