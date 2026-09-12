import { assertStringIncludes } from 'jsr:@std/assert@0.224'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { IntlProvider } from '@zanix/space-ui'
import { ConsentView } from 'ui/pages/consent/index.ts'

const TEST_MESSAGES = { 'consent/heading': 'Cookie consent' }

Deno.test('ConsentView: renders the cookie-consent heading', () => {
  const html = renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: 'en', messages: TEST_MESSAGES },
      createElement(ConsentView, {}),
    ),
  )
  assertStringIncludes(html, '<h1>Cookie consent</h1>')
})
