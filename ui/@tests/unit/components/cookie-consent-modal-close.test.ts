import { assert, assertEquals } from 'jsr:@std/assert@0.224'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createCookieConsentModal } from 'ui/components/cookie-consent-modal/render.ts'

/**
 * Closing the consent dialog without choosing (Escape, `closeOnEscape: true`) records a decline,
 * the same request the Decline button sends. Exercised at the factory level: the `onClose` is
 * read off the `Modal` element the component returns, and `fetch` is replaced for the one request it triggers.
 */
Deno.test('CookieConsentModal: dismissing the dialog records a decline (accepted: false)', async () => {
  const CookieConsentModal = createCookieConsentModal<ReactElement>(
    createElement as unknown as CreateElement<ReactElement>,
    { useState: <T>(initial: T) => [initial, () => {}] as [T, (value: T) => void] },
    {
      Modal: () => null,
      Button: () => createElement('button'),
    },
  )
  const element = CookieConsentModal({ lang: 'en', initialDecided: false }) as unknown as {
    props: Record<string, unknown>
  }
  const modalProps = element.props
  assertEquals(modalProps.open, true)
  assertEquals(modalProps.closeOnEscape, true)

  const requests: { url: string; body: unknown }[] = []
  const original = globalThis.fetch
  let settled!: () => void
  const done = new Promise<void>((resolve) => (settled = resolve))
  globalThis.fetch = ((url: string, init: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init.body)) })
    settled()
    return Promise.resolve(new Response(null, { status: 204 }))
  }) as typeof fetch
  try {
    const onClose = modalProps.onClose as () => void
    assert(typeof onClose === 'function')
    onClose()
    await done
    assertEquals(requests, [{ url: '/en/consent', body: { accepted: false } }])
  } finally {
    globalThis.fetch = original
  }
})
