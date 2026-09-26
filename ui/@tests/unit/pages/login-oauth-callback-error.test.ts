import { assertStringIncludes } from 'jsr:@std/assert@0.224'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { IntlProvider } from '@zanix/space-ui'
import { OauthCallbackErrorView } from 'ui/pages/login-oauth-callback-error/index.ts'

const TEST_MESSAGES = {
  'login/oauth/error-heading': "Sign-in didn't complete",
  'login/oauth/error-body':
    'Something went wrong finishing sign-in. You can try again from the sign-in page.',
  'common/back-to-sign-in': 'Back to sign in',
  'common/try-again': 'Try again',
}

Deno.test('OauthCallbackErrorView: renders the error heading/body and a back-to-sign-in link', () => {
  const html = renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: 'en', messages: TEST_MESSAGES },
      createElement(OauthCallbackErrorView, { params: { lang: 'en' }, reset: () => {} }),
    ),
  )
  assertStringIncludes(html, 'Sign-in didn')
  assertStringIncludes(html, 'complete</h1>')
  assertStringIncludes(html, 'href="/en/login"')
  assertStringIncludes(html, 'Try again')
  // The back link carries a `data-space` hook so themes style it; a bare `<a>` would fall back to
  // the browser's default link styling (same reason as `totp-enroll.test.ts`'s `otpauth-link`).
  assertStringIncludes(html, 'data-space="auth-back-link"')
})

Deno.test('OauthCallbackErrorView: falls back to "en" when params carries no lang', () => {
  const html = renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: 'en', messages: TEST_MESSAGES },
      createElement(OauthCallbackErrorView, { params: {}, reset: () => {} }),
    ),
  )
  assertStringIncludes(html, 'href="/en/login"')
})
