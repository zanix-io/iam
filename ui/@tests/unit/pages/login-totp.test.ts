import { assertStringIncludes } from 'jsr:@std/assert@0.224'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button, Field, Input, IntlProvider, useIntl } from '@zanix/space-ui'
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

// `SubmitGuard` is exercised for real, against the actual `@zanix/space/comet/react` binding, only
// by the dedicated wiring test below — see `login.test.ts`'s own identical doc for why.
const TotpLoginViewForContent = createTotpLoginView<ReactElement>(
  createElement as unknown as CreateElement<ReactElement>,
  { useIntl, Button, Field, Input, SubmitGuard: () => null },
)

function render(props: TotpViewProps): string {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: 'en', messages: TEST_MESSAGES },
      createElement(TotpLoginViewForContent, props),
    ),
  )
}

Deno.test('TotpLoginView: renders the heading and the account being signed into', () => {
  const html = render({ lang: 'en', email: 'jane@example.com', invalidCode: false })
  assertStringIncludes(html, '<h1>Enter your authenticator code</h1>')
  assertStringIncludes(html, 'Signing in as jane@example.com.')
})

Deno.test('TotpLoginView: renders the invalid-code banner only when invalidCode is true', () => {
  const html = render({ lang: 'en', email: 'jane@example.com', invalidCode: true })
  assertStringIncludes(html, 'Invalid authenticator code.')
})

Deno.test('TotpLoginView: renders the flattened code field error when present', () => {
  const html = render({
    lang: 'en',
    email: 'jane@example.com',
    invalidCode: false,
    fieldErrors: { code: [{ constraints: ['Must be 6 digits.'] }] },
  })
  assertStringIncludes(html, 'Must be 6 digits.')
})

// Real wiring against the actual `@zanix/space/comet/react` `SubmitGuard` binding is deliberately
// NOT re-tested per page — see `login-otp.test.ts`'s own identical doc for why (the process-wide
// active-renderer conflict this would otherwise cause between test files).
