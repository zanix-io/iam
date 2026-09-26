import type { LayoutProps, PageContext, SpaceChildren } from '@zanix/space'
import type { IntlMessages } from '@zanix/space-ui'
import type { ReactElement } from 'react'

import { loadMessages } from '@zanix/space'
import { LangLayout as LangLayoutView } from 'ui/pages/lang-layout/index.ts'
import { hasCookieConsentDecision } from 'utils/cookie-consent.ts'
import { isCookieConsentEnabled, resolveMessageOverrides } from 'utils/constants.ts'
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
  /** This request's own resolved message catalog — `loadMessages({ lang })` (`@zanix/space`)
   * merged with {@linkcode resolveMessageOverrides}'s own `IAM_MESSAGES` override, resolved ONCE
   * here so every page under this layout shares the same `<IntlProvider>`, rather than each page
   * re-resolving (and re-merging) its own copy. */
  messages: IntlMessages
}

/** Resolves this layout's own {@linkcode LangLayoutData} for every page under `[lang]/`. */
export const loader = async (ctx: PageContext<LangParams>): Promise<LangLayoutData> => ({
  lang: ctx.params.lang,
  cookiesDecided: hasCookieConsentDecision(ctx.request.headers.get('cookie')),
  cspNonce: ctx.cspNonce,
  messages: {
    ...await loadMessages({ lang: ctx.params.lang }),
    ...resolveMessageOverrides(),
  },
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
 * password-recovery/OAuth2 page. `@zanix/auth`'s own `checkAcceptedCookies` resolves `false` unless
 * a request already carries an accepted-cookies signal, and without it `sessionHeadersInterceptor`
 * emits no session `Set-Cookie` — a login succeeds but no session persists in the browser.
 *
 * A per-form mechanism (attaching `X-Znx-Cookies-Accepted: true` as a header on one form's own
 * `fetch()`-driven submit) can't cover this project: one of its session-issuing entry points —
 * `login/[oauth]/callback/page.tsx` — mints a session from a plain `GET` the OAuth2 provider's own
 * browser redirect delivers, with no form to attach to. A single, project-wide gate shown before
 * the user reaches ANY of those flows (this layout wraps every one of them) persists the decision
 * as a real cookie (`./consent/page.tsx`), so `checkAcceptedCookies`'s own cookie fallback picks it
 * up uniformly for every later request, OAuth2's plain `GET` included.
 *
 * {@linkcode CookieConsentModal} only mounts while `isCookieConsentEnabled()`
 * (`utils/constants.ts`'s own `COOKIE_CONSENT_ENABLED_ENV`) says so — the default. A deployment
 * that turns it off relies on `space/middleware.ts`'s own `cookieConsentBypassGuard` instead to
 * keep `checkAcceptedCookies` resolving `true` on every request, so session cookies are still
 * emitted with no modal ever shown.
 */
export default function LangLayout(
  { children, data }: LayoutProps<SpaceChildren, LangLayoutData>,
): ReactElement {
  // Built HERE, never inside `ui/pages/lang-layout` itself — that package's own view
  // stays free of any real Comet import (a Comet resolves by file path via `@zanix/space`'s own
  // manifest, one file per app; there is no dual-renderer "the" cookie-consent Comet to inject the
  // way `Button`/`IntlProvider` are). `null`, not `isCookieConsentEnabled() && (...)`'s own
  // `false`, when disabled — `LangLayoutView`'s own slot prop treats both as equally "nothing to
  // render," and `null` is the real value a disabled/not-yet-decided consent state is documented
  // to carry (see `pages/lang-layout/types.ts`'s own `cookieConsentSlot` doc).
  const cookieConsentSlot = isCookieConsentEnabled()
    ? (
      <CookieConsentModal
        lang={data.lang}
        initialDecided={data.cookiesDecided}
        cspNonce={data.cspNonce}
      />
    )
    : null

  return LangLayoutView({ children, data: { ...data, cookieConsentSlot } })
}
