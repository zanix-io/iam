/**
 * @module
 *
 * Pure, DOM-free cookie-consent helpers — plain data in, data out, no `document`, no `fetch` call
 * itself — so they run identically server-side (`[lang]/layout.tsx`'s own `loader`, computing the
 * consent modal's initial state from `ctx.request`'s `Cookie` header) and client-side (the modal
 * comet, building the round trip that records a decision), and are directly unit-testable with no
 * browser involved.
 *
 * This project composes its cookie-consent gate ONCE, project-wide, in the root `[lang]/layout.tsx`
 * — see that layout's own doc for why it is project-wide rather than per-form.
 */

/**
 * The exact cookie/header name `@zanix/auth`'s `checkAcceptedCookies`/`getSessionHeaders`
 * (`GENERAL_HEADERS.cookiesAcceptedHeader`, `@zanix/server`'s own `utils/constants.ts`) read and
 * write — hardcoded here rather than imported: this module is imported by a Comet
 * (`../space/comets/cookie-consent-modal.comet.tsx`), which client-bundles, and pulling the whole
 * `@zanix/server` dependency graph into that bundle for one string constant is unnecessary weight.
 * Keep this in sync with `@zanix/server`'s own constant if it ever changes.
 */
export const COOKIES_ACCEPTED_COOKIE = 'X-Znx-Cookies-Accepted'

/**
 * Whether a real request's `Cookie` header already carries a RECORDED consent decision — Accepted
 * OR Declined, either one — re-derived from a raw `Cookie` header string so it runs identically on
 * the server (`[lang]/layout.tsx`'s own `loader`, from `ctx.request.headers.get('cookie')`) and on
 * the client (`document.cookie`, same shape), with no DOM dependency either way.
 *
 * Deliberately broader than {@linkcode hasAcceptedCookiesCookie}: this is what decides whether the
 * consent MODAL shows again, not whether `@zanix/auth` may emit real session cookies. A visitor who
 * already declined shouldn't be re-prompted on every single page navigation — this project persists
 * that decision as `${COOKIES_ACCEPTED_COOKIE}=false` (see
 * `../space/routes/[lang]/consent/page.tsx`'s own doc), which this helper recognizes as "already
 * decided" even though `hasAcceptedCookiesCookie` (and `@zanix/auth`'s own `checkAcceptedCookies`)
 * still correctly treat it as not-accepted.
 *
 * @param cookieHeader - A raw `Cookie` header value (`"a=1; b=2"`), or `document.cookie`'s own
 * identically-shaped string. `''`/`undefined` (no cookies at all) is handled like any other miss.
 */
export function hasCookieConsentDecision(cookieHeader: string | null | undefined): boolean {
  const prefix = `${COOKIES_ACCEPTED_COOKIE}=`
  return (cookieHeader ?? '')
    .split(';')
    .map((entry) => entry.trim())
    .some((entry) => entry.startsWith(prefix))
}

/**
 * Whether a real request already carries an ACCEPTED cookie-consent cookie — the same signal
 * `@zanix/auth`'s own `checkAcceptedCookies` cookie fallback reads (`cookies[name] === 'true'`),
 * re-derived here from a raw `Cookie` header string for the same server/client reuse
 * {@linkcode hasCookieConsentDecision} documents.
 *
 * @param cookieHeader - A raw `Cookie` header value, or `document.cookie`'s own identically-shaped
 * string.
 */
export function hasAcceptedCookiesCookie(cookieHeader: string | null | undefined): boolean {
  return (cookieHeader ?? '')
    .split(';')
    .map((entry) => entry.trim())
    .includes(`${COOKIES_ACCEPTED_COOKIE}=true`)
}

/**
 * Builds the real `fetch()` call the consent modal's Accept/Decline buttons issue — a plain
 * data-in-data-out function so it's directly testable against a real bootstrapped server,
 * exercising the EXACT same production request shape the comet's own click handlers send, rather
 * than a re-implementation the test could drift from.
 *
 * Targets `/{lang}/consent` — a real `@zanix/space` PAGE action
 * (`../space/routes/[lang]/consent/page.tsx`), not an unprefixed REST endpoint: `zanix space dev`
 * never auto-discovers this project's own REST handlers (only `mod.ts`'s own `Zanix.start()` call
 * does), so a REST-shaped consent endpoint would be unreachable there. `lang` must be the CURRENT page's own resolved
 * language segment (e.g. `[lang]/layout.tsx`'s own `data.lang`) — this project's `langPreHandler`
 * 301-redirects any unprefixed path, so a hardcoded or missing prefix would never reach this route.
 *
 * @param lang - The current request's own resolved `{lang}` segment.
 * @param accepted - The operator's real consent decision. Always sent explicitly as a JSON
 * `boolean`, never omitted — see `consent/page.tsx`'s own doc for why BOTH `true` and `false` are
 * persisted as real, distinct cookie values, not just the accepted case.
 */
export function buildConsentRequest(
  lang: string,
  accepted: boolean,
): { url: string; init: RequestInit } {
  return {
    url: `/${lang}/consent`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accepted }),
    },
  }
}
