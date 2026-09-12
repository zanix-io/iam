import { assertStringIncludes } from 'jsr:@std/assert@0.224'
import { h } from 'preact'
import { render as renderToString } from 'preact-render-to-string'
import { IntlProvider } from '@zanix/space-ui/preact'
import { TotpConfirmView } from 'ui/pages/totp-confirm/index.preact.ts'

const TEST_MESSAGES = { 'totp/confirm/heading': 'Confirm authenticator app' }

Deno.test('TotpConfirmView (preact): renders the confirm-authenticator heading', () => {
  const html = renderToString(
    h(IntlProvider, { locale: 'en', messages: TEST_MESSAGES }, h(TotpConfirmView, {})),
  )
  assertStringIncludes(html, '<h1>Confirm authenticator app</h1>')
})
