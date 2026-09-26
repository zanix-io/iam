import { assertStringIncludes } from 'jsr:@std/assert@0.224'
import '@zanix/space/react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { IntlProvider } from '@zanix/space-ui'
import { registerApp } from '@zanix/app/runtime'

import iamSpaceApp from '../../../space.app.ts'
import { LoginView } from '../../pages/login/index.ts'
import { IAM_UI_MESSAGES_EN } from '../../sdk/messages/en.ts'

/**
 * The password-login heading resolves through the `iam` space app's `loginHeading` behavior once
 * that app is registered with `@zanix/app`'s runtime (here with a host-style replacement of the
 * default); `login.test.ts` covers the unregistered fallback and the explicit `heading` prop.
 */
await registerApp(
  {
    ...iamSpaceApp.definition,
    setup: undefined,
    behaviors: {
      loginHeading: { default: () => 'Welcome back', description: 'test override' },
    },
  } as never,
  new Map(),
)

Deno.test('LoginView: the password-mode heading comes from the registered loginHeading behavior', () => {
  const html = renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: 'en', messages: IAM_UI_MESSAGES_EN },
      createElement(LoginView, {
        lang: 'en',
        invalidCredentials: false,
        rateLimited: false,
        unexpectedError: false,
        oauthProviders: [],
      } as never),
    ),
  )
  assertStringIncludes(html, '<h1>Welcome back</h1>')
})
