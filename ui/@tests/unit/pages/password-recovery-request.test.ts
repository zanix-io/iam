import { assertStringIncludes } from 'jsr:@std/assert@0.224'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { IntlProvider } from '@zanix/space-ui'
import { RecoveryRequestView } from 'ui/pages/password-recovery-request/index.ts'

const TEST_MESSAGES = {
  'password/recovery/request-heading': 'Check your email',
  'password/recovery/request-body': 'If an account exists for {email}, a recovery code has ' +
    'been sent.',
  'password/recovery/have-code-link': 'I have my code',
}

Deno.test('RecoveryRequestView: renders the heading and interpolates the real email', () => {
  const html = renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: 'en', messages: TEST_MESSAGES },
      createElement(RecoveryRequestView, { lang: 'en', email: 'jane@example.com' }),
    ),
  )
  assertStringIncludes(html, '<h1>Check your email</h1>')
  assertStringIncludes(html, 'If an account exists for jane@example.com')
})

Deno.test('RecoveryRequestView: links to the callback step with the email pre-filled', () => {
  const html = renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: 'en', messages: TEST_MESSAGES },
      createElement(RecoveryRequestView, { lang: 'en', email: 'jane@example.com' }),
    ),
  )
  assertStringIncludes(
    html,
    'href="/en/password/recovery/callback?email=jane%40example.com"',
  )
})
