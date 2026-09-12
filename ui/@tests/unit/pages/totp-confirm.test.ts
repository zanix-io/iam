import { assertStringIncludes } from 'jsr:@std/assert@0.224'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { IntlProvider } from '@zanix/space-ui'
import { TotpConfirmView } from 'ui/pages/totp-confirm/index.ts'

const TEST_MESSAGES = { 'totp/confirm/heading': 'Confirm authenticator app' }

Deno.test('TotpConfirmView: renders the confirm-authenticator heading', () => {
  const html = renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: 'en', messages: TEST_MESSAGES },
      createElement(TotpConfirmView, {}),
    ),
  )
  assertStringIncludes(html, '<h1>Confirm authenticator app</h1>')
})
