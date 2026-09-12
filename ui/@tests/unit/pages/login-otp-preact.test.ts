import { assertStringIncludes } from 'jsr:@std/assert@0.224'
import { h } from 'preact'
import type { VNode } from 'preact'
import { render as renderToString } from 'preact-render-to-string'
import { Button, Field, Input, IntlProvider, useIntl } from '@zanix/space-ui/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createOtpView } from 'ui/pages/login-otp/render.ts'
import type { OtpViewProps } from 'ui/pages/login-otp/types.ts'

const TEST_MESSAGES = {
  'login/otp/heading': 'Enter your verification code',
  'login/otp/sent-to': 'A verification code was sent for {email}.',
  'login/otp/code-label': 'Verification code',
  'common/invalid-or-expired-code': 'Invalid or expired code.',
  'common/verify': 'Verify',
  'common/back-to-sign-in': 'Back to sign in',
}

// `SubmitGuard` is exercised for real, against the actual `@zanix/space/comet/preact` binding,
// only by the dedicated wiring test below — see `login.test.ts`'s own identical doc for why.
const OtpViewForContent = createOtpView<VNode>(
  h as unknown as CreateElement<VNode>,
  { useIntl, Button, Field, Input, SubmitGuard: () => null },
)

function render(props: OtpViewProps): string {
  return renderToString(
    h(IntlProvider, { locale: 'en', messages: TEST_MESSAGES }, h(OtpViewForContent, props)),
  )
}

Deno.test('OtpView (preact): renders the heading and the destination the code was sent to', () => {
  const html = render({ lang: 'en', email: 'jane@example.com', invalidCode: false })
  assertStringIncludes(html, '<h1>Enter your verification code</h1>')
  assertStringIncludes(html, 'A verification code was sent for jane@example.com.')
})

Deno.test('OtpView (preact): renders the invalid-code banner only when invalidCode is true', () => {
  const html = render({ lang: 'en', email: 'jane@example.com', invalidCode: true })
  assertStringIncludes(html, 'Invalid or expired code.')
})

// Real wiring against the actual `@zanix/space/comet/preact` `SubmitGuard` binding is deliberately
// NOT re-tested per page — see `login-otp.test.ts`'s own identical doc for why (the process-wide
// active-renderer conflict this would otherwise cause between test files).
