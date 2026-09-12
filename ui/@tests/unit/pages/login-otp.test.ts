import { assertStringIncludes } from 'jsr:@std/assert@0.224'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button, Field, Input, IntlProvider, useIntl } from '@zanix/space-ui'
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

// `SubmitGuard` is exercised for real, against the actual `@zanix/space/comet/react` binding, only
// by the dedicated wiring test below — see `login.test.ts`'s own identical doc for why.
const OtpViewForContent = createOtpView<ReactElement>(
  createElement as unknown as CreateElement<ReactElement>,
  { useIntl, Button, Field, Input, SubmitGuard: () => null },
)

function render(props: OtpViewProps): string {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: 'en', messages: TEST_MESSAGES },
      createElement(OtpViewForContent, props),
    ),
  )
}

Deno.test('OtpView: renders the heading and the destination the code was sent to', () => {
  const html = render({
    lang: 'en',
    email: 'jane@example.com',
    invalidCode: false,
  })
  assertStringIncludes(html, '<h1>Enter your verification code</h1>')
  assertStringIncludes(html, 'A verification code was sent for jane@example.com.')
})

Deno.test('OtpView: renders the invalid-code banner only when invalidCode is true', () => {
  const html = render({ lang: 'en', email: 'jane@example.com', invalidCode: true })
  assertStringIncludes(html, 'Invalid or expired code.')
})

Deno.test('OtpView: renders the flattened code field error when present', () => {
  const html = render({
    lang: 'en',
    email: 'jane@example.com',
    invalidCode: false,
    fieldErrors: { code: [{ constraints: ['Must be 6 digits.'] }] },
  })
  assertStringIncludes(html, 'Must be 6 digits.')
})

Deno.test('OtpView: carries the email as a hidden field for the action to read back', () => {
  const html = render({ lang: 'en', email: 'jane@example.com', invalidCode: false })
  assertStringIncludes(html, 'name="email" value="jane@example.com"')
})

// Real wiring against the actual `@zanix/space/comet/react` `SubmitGuard` binding is deliberately
// NOT re-tested per page — `login.test.ts`/`login-preact.test.ts` already exercise the identical
// `defineComet`/`CometBoundary` element-factory mechanism for real (via `ManagedForm`, a sibling
// Comet going through the exact same wiring); the active-renderer registration those tests trigger
// is process-wide, so a second pair repeating it here would fight the first for which renderer
// stays "active" depending on file execution order — a real, confirmed conflict, not a
// theoretical one.
