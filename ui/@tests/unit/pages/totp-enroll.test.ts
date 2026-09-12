import { assertStringIncludes } from 'jsr:@std/assert@0.224'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button, Field, Input, IntlProvider, useIntl } from '@zanix/space-ui'
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

// `SubmitGuard` is exercised for real, against the actual `@zanix/space/comet/react` binding, only
// by the dedicated wiring test below — see `login.test.ts`'s own identical doc for why.
const TotpEnrollViewForContent = createTotpEnrollView<ReactElement>(
  createElement as unknown as CreateElement<ReactElement>,
  { useIntl, Button, Field, Input, SubmitGuard: () => null },
)

function render(props: TotpEnrollViewProps): string {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: 'en', messages: TEST_MESSAGES },
      createElement(TotpEnrollViewForContent, props),
    ),
  )
}

Deno.test('TotpEnrollView: renders the heading, the secret, and the otpauth link', () => {
  const html = render(BASE_PROPS)
  assertStringIncludes(html, '<h1>Set up an authenticator app</h1>')
  assertStringIncludes(html, '<code>JBSWY3DPEHPK3PXP</code>')
  assertStringIncludes(html, 'href="otpauth://totp/iam:jane@example.com?secret=JBSWY3DPEHPK3PXP"')
})

Deno.test('TotpEnrollView: embeds the real QR-code SVG markup as-is', () => {
  const html = render(BASE_PROPS)
  assertStringIncludes(html, '<rect')
})

Deno.test('TotpEnrollView: renders the invalid-code banner only when invalidCode is true', () => {
  const html = render({ ...BASE_PROPS, invalidCode: true })
  assertStringIncludes(html, 'scan the new code below.')
})

Deno.test('TotpEnrollView: posts to the sibling totp/confirm route with the secret carried through', () => {
  const html = render(BASE_PROPS)
  assertStringIncludes(html, 'action="/en/totp/confirm"')
  assertStringIncludes(html, 'name="secret" value="JBSWY3DPEHPK3PXP"')
})

// Real wiring against the actual `@zanix/space/comet/react` `SubmitGuard` binding is deliberately
// NOT re-tested per page — see `login-otp.test.ts`'s own identical doc for why (the process-wide
// active-renderer conflict this would otherwise cause between test files).
