import { assertStringIncludes } from 'jsr:@std/assert@0.224'
import { h } from 'preact'
import type { VNode } from 'preact'
import { render as renderToString } from 'preact-render-to-string'
import { Button, IntlProvider, useIntl } from '@zanix/space-ui/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createOauthStartView } from 'ui/pages/login-oauth-start/render.ts'
import type { OauthStartViewProps } from 'ui/pages/login-oauth-start/types.ts'

const TEST_MESSAGES = {
  'login/oauth-continue': 'Continue with {provider}',
  'common/back-to-sign-in': 'Back to sign in',
}

const OauthStartViewForContent = createOauthStartView<VNode>(
  h as unknown as CreateElement<VNode>,
  { useIntl, Button, SubmitGuard: () => null, AutoSubmit: () => null },
)

function render(props: OauthStartViewProps): string {
  return renderToString(
    h(IntlProvider, { locale: 'en', messages: TEST_MESSAGES }, h(OauthStartViewForContent, props)),
  )
}

Deno.test('OauthStartView (preact): renders the "Continue with {provider}" heading and button', () => {
  const html = render({ lang: 'en', oauth: 'google', csrfToken: 'tok' })
  assertStringIncludes(html, '<h1>Continue with Google</h1>')
  assertStringIncludes(html, 'Continue with Google</button>')
})

Deno.test('OauthStartView (preact): carries the CSRF token as a hidden field', () => {
  const html = render({ lang: 'en', oauth: 'google', csrfToken: 'the-token' })
  assertStringIncludes(html, 'value="the-token"')
})

Deno.test('OauthStartView (preact): links back to the sign-in page', () => {
  const html = render({ lang: 'fr', oauth: 'github', csrfToken: 'tok' })
  assertStringIncludes(html, 'href="/fr/login"')
  assertStringIncludes(html, 'Back to sign in')
  // Same `data-space` back-link styling hook the non-preact test asserts.
  assertStringIncludes(html, 'data-space="auth-back-link"')
})

Deno.test('OauthStartView (index.preact.ts): the real binding constructs without throwing', async () => {
  const mod = await import('ui/pages/login-oauth-start/index.preact.ts')
  if (typeof mod.OauthStartView !== 'function') throw new Error('expected a function export')
})
