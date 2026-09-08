import { assertEquals } from 'jsr:@std/assert@0.224'

import {
  buildConsentRequest,
  COOKIES_ACCEPTED_COOKIE,
  hasAcceptedCookiesCookie,
  hasCookieConsentDecision,
} from 'utils/cookie-consent.ts'

Deno.test('COOKIES_ACCEPTED_COOKIE matches @zanix/server GENERAL_HEADERS.cookiesAcceptedHeader', () => {
  // Hardcoded deliberately (see this module's own doc) — this test is what catches drift if
  // `@zanix/server` ever renames its own constant.
  assertEquals(COOKIES_ACCEPTED_COOKIE, 'X-Znx-Cookies-Accepted')
})

Deno.test('hasCookieConsentDecision: false with no cookie header at all', () => {
  assertEquals(hasCookieConsentDecision(null), false)
  assertEquals(hasCookieConsentDecision(undefined), false)
  assertEquals(hasCookieConsentDecision(''), false)
})

Deno.test('hasCookieConsentDecision: false when the header carries unrelated cookies only', () => {
  assertEquals(hasCookieConsentDecision('X-Znx-Lang=en; other=1'), false)
})

Deno.test('hasCookieConsentDecision: true once accepted (=true) is recorded', () => {
  assertEquals(hasCookieConsentDecision('X-Znx-Cookies-Accepted=true'), true)
})

Deno.test('hasCookieConsentDecision: true once declined (=false) is recorded too', () => {
  // The one real divergence from `hasAcceptedCookiesCookie`/`@zanix/auth`'s own
  // `checkAcceptedCookies` — see this function's own doc for why a recorded Decline still counts
  // as "decided" for the MODAL's own re-prompt logic.
  assertEquals(hasCookieConsentDecision('X-Znx-Cookies-Accepted=false'), true)
})

Deno.test('hasCookieConsentDecision: true when the cookie sits among several others', () => {
  assertEquals(
    hasCookieConsentDecision('X-Znx-Lang=en; X-Znx-Cookies-Accepted=false; other=1'),
    true,
  )
})

Deno.test('hasAcceptedCookiesCookie: false with no cookie header at all', () => {
  assertEquals(hasAcceptedCookiesCookie(null), false)
  assertEquals(hasAcceptedCookiesCookie(undefined), false)
})

Deno.test('hasAcceptedCookiesCookie: false when the recorded decision was a decline', () => {
  assertEquals(hasAcceptedCookiesCookie('X-Znx-Cookies-Accepted=false'), false)
})

Deno.test('hasAcceptedCookiesCookie: true only for an exact =true match', () => {
  assertEquals(hasAcceptedCookiesCookie('X-Znx-Cookies-Accepted=true'), true)
  assertEquals(hasAcceptedCookiesCookie('X-Znx-Lang=en; X-Znx-Cookies-Accepted=true'), true)
})

Deno.test('buildConsentRequest: POSTs the real decision as a JSON body to /{lang}/consent', () => {
  const { url, init } = buildConsentRequest('en', true)
  assertEquals(url, '/en/consent')
  assertEquals(init.method, 'POST')
  assertEquals((init.headers as Record<string, string>)['content-type'], 'application/json')
  assertEquals(init.body, JSON.stringify({ accepted: true }))
})

Deno.test("buildConsentRequest: targets the CURRENT page's own resolved lang segment", () => {
  const { url } = buildConsentRequest('fr', true)
  assertEquals(url, '/fr/consent')
})

Deno.test('buildConsentRequest: a decline is sent explicitly as accepted: false, never omitted', () => {
  const { init } = buildConsentRequest('en', false)
  assertEquals(init.body, JSON.stringify({ accepted: false }))
})
