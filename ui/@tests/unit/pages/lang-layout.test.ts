import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LangLayout } from 'ui/pages/lang-layout/index.ts'
import type { LangLayoutViewData } from 'ui/pages/lang-layout/types.ts'

function render(data: LangLayoutViewData<ReturnType<typeof createElement>>) {
  return renderToStaticMarkup(createElement(LangLayout, { children: 'page content', data }))
}

Deno.test('LangLayout: renders <html lang> from the given data', () => {
  const html = render({ lang: 'fr', messages: {} })
  assertStringIncludes(html, '<html lang="fr">')
})

Deno.test('LangLayout: renders the charset and viewport meta tags', () => {
  const html = render({ lang: 'en', messages: {} })
  assertStringIncludes(html, 'charSet="utf-8"')
  assertStringIncludes(html, 'name="viewport"')
})

Deno.test('LangLayout: renders the page children inside the body', () => {
  const html = render({ lang: 'en', messages: {} })
  assertStringIncludes(html, 'page content')
})

Deno.test('LangLayout: renders the given cookieConsentSlot element', () => {
  const html = render({
    lang: 'en',
    messages: {},
    cookieConsentSlot: createElement('div', { 'data-testid': 'consent-modal' }),
  })
  assertStringIncludes(html, 'data-testid="consent-modal"')
})

Deno.test('LangLayout: renders no consent slot markup when cookieConsentSlot is null', () => {
  const html = render({ lang: 'en', messages: {}, cookieConsentSlot: null })
  assertEquals(html.includes('data-testid'), false)
})
