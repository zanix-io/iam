import { assertStringIncludes } from 'jsr:@std/assert@0.224'
import { h } from 'preact'
import { render as renderToString } from 'preact-render-to-string'
import { IntlProvider } from '@zanix/space-ui/preact'
import { ConsentView } from 'ui/pages/consent/index.preact.ts'

const TEST_MESSAGES = { 'consent/heading': 'Cookie consent' }

Deno.test('ConsentView (preact): renders the cookie-consent heading', () => {
  const html = renderToString(
    h(IntlProvider, { locale: 'en', messages: TEST_MESSAGES }, h(ConsentView, {})),
  )
  assertStringIncludes(html, '<h1>Cookie consent</h1>')
})
