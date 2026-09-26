import { assertStringIncludes } from 'jsr:@std/assert@0.224'
import { h } from 'preact'
import { render as renderToString } from 'preact-render-to-string'
import { IntlProvider } from '@zanix/space-ui/preact'
import { OauthCallbackErrorView } from 'ui/pages/login-oauth-callback-error/index.preact.ts'

const TEST_MESSAGES = {
  'login/oauth/error-heading': "Sign-in didn't complete",
  'login/oauth/error-body':
    'Something went wrong finishing sign-in. You can try again from the sign-in page.',
  'common/back-to-sign-in': 'Back to sign in',
  'common/try-again': 'Try again',
}

Deno.test(
  'OauthCallbackErrorView (preact): renders the error heading/body and a back-to-sign-in link',
  () => {
    const html = renderToString(
      h(
        IntlProvider,
        { locale: 'en', messages: TEST_MESSAGES },
        h(OauthCallbackErrorView, { params: { lang: 'en' }, reset: () => {} }),
      ),
    )
    assertStringIncludes(html, 'Sign-in didn')
    assertStringIncludes(html, 'complete</h1>')
    assertStringIncludes(html, 'href="/en/login"')
    assertStringIncludes(html, 'Try again')
    // Same `data-space` back-link styling hook the non-preact test asserts.
    assertStringIncludes(html, 'data-space="auth-back-link"')
  },
)
