import { assertStringIncludes } from 'jsr:@std/assert@0.224'
import { h } from 'preact'
import type { VNode } from 'preact'
import { render as renderToString } from 'preact-render-to-string'
import { Button, Field, Input, IntlProvider, useIntl } from '@zanix/space-ui/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createTotpEnrollView } from 'ui/pages/totp-enroll/render.ts'
import type { TotpEnrollViewProps } from 'ui/pages/totp-enroll/types.ts'

const TEST_MESSAGES = {
  'totp/enroll/heading': 'Set up an authenticator app',
  'totp/enroll/invalid-code': 'Invalid authenticator code — scan the new code below.',
  'totp/enroll/scan-aria-label': 'Scan this QR code with your authenticator app',
  'totp/enroll/scan-instructions':
    'Scan this in your authenticator app, or enter the key manually:',
  'totp/enroll/code-label': 'Authenticator code',
  'totp/enroll/submit': 'Confirm',
}

const BASE_PROPS: TotpEnrollViewProps = {
  lang: 'en',
  secret: 'JBSWY3DPEHPK3PXP',
  uri: 'otpauth://totp/iam:jane@example.com?secret=JBSWY3DPEHPK3PXP',
  qrCodeSvg: '<svg><rect /></svg>',
  invalidCode: false,
}

// `SubmitGuard` is exercised for real, against the actual `@zanix/space/comet/preact` binding,
// only by the dedicated wiring test below — see `login.test.ts`'s own identical doc for why.
const TotpEnrollViewForContent = createTotpEnrollView<VNode>(
  h as unknown as CreateElement<VNode>,
  { useIntl, Button, Field, Input, SubmitGuard: () => null },
)

function render(props: TotpEnrollViewProps): string {
  return renderToString(
    h(
      IntlProvider,
      { locale: 'en', messages: TEST_MESSAGES },
      h(TotpEnrollViewForContent, props),
    ),
  )
}

Deno.test('TotpEnrollView (preact): renders the heading, the secret, and the otpauth link', () => {
  const html = render(BASE_PROPS)
  assertStringIncludes(html, '<h1>Set up an authenticator app</h1>')
  assertStringIncludes(html, '<code>JBSWY3DPEHPK3PXP</code>')
})

Deno.test('TotpEnrollView (preact): embeds the real QR-code SVG markup as-is', () => {
  const html = render(BASE_PROPS)
  assertStringIncludes(html, '<rect')
})

// Real wiring against the actual `@zanix/space/comet/preact` `SubmitGuard` binding is deliberately
// NOT re-tested per page — see `login-otp.test.ts`'s own identical doc for why (the process-wide
// active-renderer conflict this would otherwise cause between test files).
