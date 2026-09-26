import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import '../dom-test-setup.ts'
import { h, render as renderDom } from 'preact'
import type { VNode } from 'preact'
import { render as renderToString } from 'preact-render-to-string'
import { IntlProvider } from '@zanix/space-ui/preact'
import { IAM_UI_MESSAGES_EN } from '../../../sdk/messages.ts'
import { CookieConsentModal } from 'ui/components/cookie-consent-modal/index.preact.ts'

// Same behavior as `cookie-consent-modal.test.ts` (the React binding), verified independently
// against the Preact one — this pair is what actually proves `createCookieConsentModal`'s shared
// logic (`render.ts`) — including its `useState` usage — behaves identically regardless of which
// renderer it's bound to. Called via `h(CookieConsentModal, props)`, never JSX.

/** `CookieConsentModal` reads its own copy via `useIntl()`, which throws outside a real
 * `IntlProvider` — every render site in this file goes through this instead of a bare
 * `h(CookieConsentModal, props)`. */
function withIntl<P>(element: VNode<P>) {
  return h(IntlProvider, { locale: 'en', messages: IAM_UI_MESSAGES_EN }, element)
}

Deno.test('CookieConsentModal (preact): open by default when no decision was recorded yet', () => {
  const html = renderToString(
    withIntl(h(CookieConsentModal, { lang: 'en', initialDecided: false })),
  )
  assertStringIncludes(html, 'Session cookie')
  assertStringIncludes(html, 'Accept')
  assertStringIncludes(html, 'Decline')
})

Deno.test('CookieConsentModal (preact): renders nothing once a decision was already recorded', () => {
  const html = renderToString(withIntl(h(CookieConsentModal, { lang: 'en', initialDecided: true })))
  assertEquals(html.includes('Session cookie'), false)
})

Deno.test('CookieConsentModal (preact): Decline posts { accepted: false } to /{lang}/consent', async () => {
  const originalFetch = globalThis.fetch
  const calls: [string, RequestInit | undefined][] = []
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push([url, init])
    return Promise.resolve(new Response(null, { status: 204 }))
  }) as typeof fetch

  try {
    const container = document.createElement('div')
    document.body.appendChild(container)
    renderDom(withIntl(h(CookieConsentModal, { lang: 'de', initialDecided: false })), container)
    const declineButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Decline')
    declineButton?.dispatchEvent(new Event('click', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
    assertEquals(calls[0]?.[0], '/de/consent')
    assertEquals(JSON.parse(String(calls[0]?.[1]?.body)), { accepted: false })
    renderDom(null, container)
  } finally {
    globalThis.fetch = originalFetch
  }
})
