import { assertStringIncludes } from 'jsr:@std/assert@0.224'
import { h } from 'preact'
import { render as renderToString } from 'preact-render-to-string'
import { IntlProvider } from '@zanix/space-ui/preact'
import { RecoveryRequestView } from 'ui/pages/password-recovery-request/index.preact.ts'

const TEST_MESSAGES = {
  'password/recovery/request-heading': 'Check your email',
  'password/recovery/request-body': 'If an account exists for {email}, a recovery code has ' +
    'been sent.',
  'password/recovery/have-code-link': 'I have my code',
}

Deno.test(
  'RecoveryRequestView (preact): renders the heading and interpolates the real email',
  () => {
    const html = renderToString(
      h(
        IntlProvider,
        { locale: 'en', messages: TEST_MESSAGES },
        h(RecoveryRequestView, { lang: 'en', email: 'jane@example.com' }),
      ),
    )
    assertStringIncludes(html, '<h1>Check your email</h1>')
    assertStringIncludes(html, 'If an account exists for jane@example.com')
  },
)
