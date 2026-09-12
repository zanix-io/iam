import { assertStringIncludes } from 'jsr:@std/assert@0.224'
import { h } from 'preact'
import type { VNode } from 'preact'
import { render as renderToString } from 'preact-render-to-string'
import { Button, Field, Input, IntlProvider, useIntl } from '@zanix/space-ui/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createRecoveryCallbackView } from 'ui/pages/password-recovery-callback/render.ts'
import type { RecoveryCallbackViewProps } from 'ui/pages/password-recovery-callback/types.ts'

const TEST_MESSAGES = {
  'password/recovery/callback-heading': 'Reset your password',
  'common/invalid-or-expired-code': 'Invalid or expired code.',
  'login/email-label': 'Email',
  'password/recovery/code-label': 'Recovery code',
  'password/recovery/password-label': 'New password',
  'password/recovery/submit': 'Reset password',
}

// `ManagedForm` is exercised for real, against the actual `@zanix/space/comet/preact` binding,
// only by the dedicated wiring test below — see `login.test.ts`'s own identical doc for why.
const RecoveryCallbackViewForContent = createRecoveryCallbackView<VNode>(
  h as unknown as CreateElement<VNode>,
  { useIntl, Button, Field, Input, ManagedForm: () => null },
)

function render(props: RecoveryCallbackViewProps): string {
  return renderToString(
    h(
      IntlProvider,
      { locale: 'en', messages: TEST_MESSAGES },
      h(RecoveryCallbackViewForContent, props),
    ),
  )
}

Deno.test('RecoveryCallbackView (preact): renders the heading', () => {
  const html = render({ email: '', invalidCode: false })
  assertStringIncludes(html, '<h1>Reset your password</h1>')
})

Deno.test('RecoveryCallbackView (preact): pre-fills the email field from the query-string value', () => {
  const html = render({ email: 'jane@example.com', invalidCode: false })
  assertStringIncludes(html, 'value="jane@example.com"')
})

// Real wiring against the actual `@zanix/space/comet/preact` `ManagedForm` binding is deliberately
// NOT re-tested per page — see `login-preact.test.ts`'s own identical doc for the original
// ManagedForm wiring test this would otherwise duplicate, and `login-otp.test.ts`'s own doc for
// why a second pair repeating this causes a real, process-wide active-renderer conflict between
// test files.
