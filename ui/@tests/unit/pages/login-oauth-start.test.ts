import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button, IntlProvider, useIntl } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createOauthStartView } from 'ui/pages/login-oauth-start/render.ts'
import type { OauthStartViewProps } from 'ui/pages/login-oauth-start/types.ts'

const TEST_MESSAGES = {
  'login/oauth-continue': 'Continue with {provider}',
  'common/back-to-sign-in': 'Back to sign in',
}

// `SubmitGuard` is exercised for real only by the dedicated wiring test at the bottom — see
// `pages/login.test.ts`'s own identical doc for why every other test here uses a `null`-rendering
// stand-in instead.
const OauthStartViewForContent = createOauthStartView<ReactElement>(
  createElement as unknown as CreateElement<ReactElement>,
  { useIntl, Button, SubmitGuard: () => null, AutoSubmit: () => null },
)

function render(props: OauthStartViewProps): string {
  const element = createElement(OauthStartViewForContent, props)
  return renderToStaticMarkup(
    createElement(IntlProvider, { locale: 'en', messages: TEST_MESSAGES }, element),
  )
}

Deno.test('OauthStartView: renders the "Continue with {provider}" heading and button', () => {
  const html = render({ lang: 'en', oauth: 'google', csrfToken: 'tok' })
  assertStringIncludes(html, '<h1>Continue with Google</h1>')
  assertStringIncludes(html, 'Continue with Google</button>')
})

Deno.test('OauthStartView: carries the CSRF token as a hidden field', () => {
  const html = render({ lang: 'en', oauth: 'google', csrfToken: 'the-token' })
  assertStringIncludes(html, 'value="the-token"')
})

Deno.test('OauthStartView: links back to the sign-in page', () => {
  const html = render({ lang: 'fr', oauth: 'github', csrfToken: 'tok' })
  assertStringIncludes(html, 'href="/fr/login"')
  assertStringIncludes(html, 'Back to sign in')
  // The back link carries its `data-space` styling hook (see `login-oauth-callback-error.test.ts`).
  assertStringIncludes(html, 'data-space="auth-back-link"')
})

Deno.test('OauthStartView (index.ts): the real binding renders without throwing, SubmitGuard included', async () => {
  await import('@zanix/space/react')
  const { OauthStartView } = await import('ui/pages/login-oauth-start/index.ts')
  const element = createElement(OauthStartView, { lang: 'en', oauth: 'google', csrfToken: 'tok' })
  const markup = renderToStaticMarkup(
    createElement(IntlProvider, { locale: 'en', messages: TEST_MESSAGES }, element),
  )
  assertStringIncludes(markup, 'Continue with Google')
})

Deno.test('OauthStartView: with no CSRF token the hidden field is empty, never "undefined"', () => {
  const html = render({ lang: 'en', oauth: 'google' } as OauthStartViewProps)
  assertStringIncludes(html, 'name="_csrf" value=""')
  assertEquals(html.includes('undefined'), false)
})
