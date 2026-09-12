import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { h } from 'preact'
import type { VNode } from 'preact'
import { render as renderToString } from 'preact-render-to-string'
import { LangLayout } from 'ui/pages/lang-layout/index.preact.ts'
import type { LangLayoutViewData } from 'ui/pages/lang-layout/types.ts'

// Same behavior as `lang-layout.test.ts` (the React binding), verified independently against the
// Preact one — proves `createLangLayout`'s shared logic behaves identically regardless of which
// renderer it's bound to.

function render(data: LangLayoutViewData<VNode>) {
  return renderToString(h(LangLayout, { children: 'page content', data }))
}

Deno.test('LangLayout (preact): renders <html lang> from the given data', () => {
  const html = render({ lang: 'fr', messages: {} })
  assertStringIncludes(html, '<html lang="fr">')
})

Deno.test('LangLayout (preact): renders the page children inside the body', () => {
  const html = render({ lang: 'en', messages: {} })
  assertStringIncludes(html, 'page content')
})

Deno.test('LangLayout (preact): renders the given cookieConsentSlot element', () => {
  const html = render({
    lang: 'en',
    messages: {},
    cookieConsentSlot: h('div', { 'data-testid': 'consent-modal' }) as VNode,
  })
  assertStringIncludes(html, 'data-testid="consent-modal"')
})

Deno.test('LangLayout (preact): renders no consent slot markup when cookieConsentSlot is null', () => {
  const html = render({ lang: 'en', messages: {}, cookieConsentSlot: null })
  assertEquals(html.includes('data-testid'), false)
})
