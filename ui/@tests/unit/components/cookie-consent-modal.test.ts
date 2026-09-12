import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import '../dom-test-setup.ts'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { CookieConsentModal } from 'ui/components/cookie-consent-modal/index.ts'

// `dom-test-setup`-equivalent minimal DOM stub — `@zanix/space-ui`'s own `must`/DOM-setup helper
// isn't published for consumers, so this file drives real interaction through `react-dom/client`
// directly (`document`/`window` are already available under this project's own `dom`/`dom.window`
// `lib` — no polyfill needed, `deno test` runs these files under Deno's own browser-compatible
// globals).

function mount(element: ReturnType<typeof createElement>) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  return {
    container,
    unmount: () => act(() => root.unmount()),
  }
}

Deno.test('CookieConsentModal: open by default when no decision was recorded yet', () => {
  const html = renderToStaticMarkup(
    createElement(CookieConsentModal, { lang: 'en', initialDecided: false }),
  )
  assertStringIncludes(html, 'Session cookie')
  assertStringIncludes(html, 'Accept')
  assertStringIncludes(html, 'Decline')
})

Deno.test('CookieConsentModal: renders nothing (Modal closed) once a decision was already recorded', () => {
  const html = renderToStaticMarkup(
    createElement(CookieConsentModal, { lang: 'en', initialDecided: true }),
  )
  assertEquals(html.includes('Session cookie'), false)
})

Deno.test('CookieConsentModal: Accept posts { accepted: true } to /{lang}/consent', async () => {
  const originalFetch = globalThis.fetch
  const calls: [string, RequestInit | undefined][] = []
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push([url, init])
    return Promise.resolve(new Response(null, { status: 204 }))
  }) as typeof fetch

  try {
    const { container, unmount } = mount(
      createElement(CookieConsentModal, { lang: 'fr', initialDecided: false }),
    )
    const acceptButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Accept')
    assertEquals(acceptButton !== undefined, true)
    await act(async () => {
      acceptButton?.dispatchEvent(new Event('click', { bubbles: true }))
      await Promise.resolve()
    })
    assertEquals(calls[0]?.[0], '/fr/consent')
    assertEquals(JSON.parse(String(calls[0]?.[1]?.body)), { accepted: true })
    unmount()
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('CookieConsentModal: a failed round trip surfaces the alert, without silently closing', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() => Promise.resolve(new Response(null, { status: 500 }))) as typeof fetch

  try {
    const { container, unmount } = mount(
      createElement(CookieConsentModal, { lang: 'en', initialDecided: false }),
    )
    const declineButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Decline')
    await act(async () => {
      declineButton?.dispatchEvent(new Event('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })
    assertStringIncludes(container.innerHTML, 'Something went wrong recording your choice.')
    unmount()
  } finally {
    globalThis.fetch = originalFetch
  }
})
