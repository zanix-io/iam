import { assertStringIncludes } from 'jsr:@std/assert@0.224'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { IntlProvider } from '@zanix/space-ui'
import { OauthCallbackView } from 'ui/pages/login-oauth-callback/index.ts'

const TEST_MESSAGES = {
  'login/oauth/callback-heading': 'Signed in',
  'login/oauth/callback-continue': 'Continue',
}

Deno.test('OauthCallbackView: renders a meta refresh to / plus a no-JS fallback link', () => {
  const html = renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: 'en', messages: TEST_MESSAGES },
      createElement(OauthCallbackView, {}),
    ),
  )
  assertStringIncludes(html, 'http-equiv="refresh"')
  assertStringIncludes(html, 'content="0;url=/"')
  assertStringIncludes(html, '<h1>Signed in</h1>')
  assertStringIncludes(html, 'href="/"')
  assertStringIncludes(html, 'Continue</a>')
  // The back link carries its `data-space` styling hook (see `login-oauth-callback-error.test.ts`).
  assertStringIncludes(html, 'data-space="auth-back-link"')
})
