import { assertStringIncludes } from 'jsr:@std/assert@0.224'
import { h } from 'preact'
import type { FunctionComponent } from 'preact'
import { render as renderToString } from 'preact-render-to-string'
import { IntlProvider } from '@zanix/space-ui/preact'
import { OauthCallbackView } from 'ui/pages/login-oauth-callback/index.preact.ts'
import type { OauthCallbackViewProps } from 'ui/pages/login-oauth-callback/index.preact.ts'

const TEST_MESSAGES = {
  'login/oauth/callback-heading': 'Signed in',
  'login/oauth/callback-continue': 'Continue',
}

Deno.test('OauthCallbackView (preact): renders a meta refresh to / plus a no-JS fallback link', () => {
  const html = renderToString(
    h(
      IntlProvider,
      { locale: 'en', messages: TEST_MESSAGES },
      h(OauthCallbackView as FunctionComponent<OauthCallbackViewProps>, {}),
    ),
  )
  assertStringIncludes(html, 'http-equiv="refresh"')
  assertStringIncludes(html, 'content="0;url=/"')
  assertStringIncludes(html, '<h1>Signed in</h1>')
  assertStringIncludes(html, 'Continue</a>')
  // Same `data-space` back-link styling hook the non-preact test asserts.
  assertStringIncludes(html, 'data-space="auth-back-link"')
})
