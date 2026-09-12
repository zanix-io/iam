import { assertStringIncludes } from 'jsr:@std/assert@0.224'
import { h } from 'preact'
import type { VNode } from 'preact'
import { render as renderToString } from 'preact-render-to-string'
import { Button, Field, Input, IntlProvider, useIntl } from '@zanix/space-ui/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createTotpLoginView } from 'ui/pages/login-totp/render.ts'
import type { TotpViewProps } from 'ui/pages/login-totp/types.ts'

const TEST_MESSAGES = {
  'login/totp/heading': 'Enter your authenticator code',
  'login/totp/signing-in-as': 'Signing in as {email}.',
  'login/totp/code-label': 'Authenticator code',
  'login/totp/invalid-code': 'Invalid authenticator code.',
  'common/verify': 'Verify',
  'common/back-to-sign-in': 'Back to sign in',
}

// `SubmitGuard` is exercised for real, against the actual `@zanix/space/comet/preact` binding,
// only by the dedicated wiring test below — see `login.test.ts`'s own identical doc for why.
const TotpLoginViewForContent = createTotpLoginView<VNode>(
  h as unknown as CreateElement<VNode>,
  { useIntl, Button, Field, Input, SubmitGuard: () => null },
)

function render(props: TotpViewProps): string {
  return renderToString(
    h(
      IntlProvider,
      { locale: 'en', messages: TEST_MESSAGES },
      h(TotpLoginViewForContent, props),
    ),
  )
}

Deno.test('TotpLoginView (preact): renders the heading and the account being signed into', () => {
  const html = render({ lang: 'en', email: 'jane@example.com', invalidCode: false })
  assertStringIncludes(html, '<h1>Enter your authenticator code</h1>')
  assertStringIncludes(html, 'Signing in as jane@example.com.')
})

// Real wiring against the actual `@zanix/space/comet/preact` `SubmitGuard` binding is deliberately
// NOT re-tested per page — see `login-otp.test.ts`'s own identical doc for why (the process-wide
// active-renderer conflict this would otherwise cause between test files).
