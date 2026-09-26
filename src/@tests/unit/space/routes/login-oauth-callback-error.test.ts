import { assert, assertEquals } from 'jsr:@std/assert@0.224'

import OauthCallbackError from 'space/routes/[lang]/login/[oauth]/callback/error.tsx'
import { OauthCallbackErrorView } from 'ui/pages/login-oauth-callback-error/index.ts'
import { renderComponentWithIntl } from '../../helpers/space-context.ts'

Deno.test('OAuth callback error boundary: renders the shared error view with the route params and reset', () => {
  const props = { params: { lang: 'en', oauth: 'google' }, reset: () => {} }
  const html = renderComponentWithIntl(OauthCallbackError as never, props as never)
  assert(html.length > 0)
  assertEquals(html, renderComponentWithIntl(OauthCallbackErrorView as never, props as never))
})
