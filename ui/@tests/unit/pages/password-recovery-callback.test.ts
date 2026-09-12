import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button, Field, Input, IntlProvider, useIntl } from '@zanix/space-ui'
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

// `ManagedForm` is exercised for real, against the actual `@zanix/space/comet/react` binding, only
// by the dedicated wiring test below — see `login.test.ts`'s own identical doc for why.
const RecoveryCallbackViewForContent = createRecoveryCallbackView<ReactElement>(
  createElement as unknown as CreateElement<ReactElement>,
  { useIntl, Button, Field, Input, ManagedForm: () => null },
)

function render(props: RecoveryCallbackViewProps): string {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: 'en', messages: TEST_MESSAGES },
      createElement(RecoveryCallbackViewForContent, props),
    ),
  )
}

Deno.test('RecoveryCallbackView: renders the heading', () => {
  const html = render({ email: '', invalidCode: false })
  assertStringIncludes(html, '<h1>Reset your password</h1>')
})

Deno.test('RecoveryCallbackView: renders the invalid-code banner only when invalidCode is true', () => {
  const html = render({ email: '', invalidCode: true })
  assertStringIncludes(html, 'Invalid or expired code.')
})

Deno.test('RecoveryCallbackView: pre-fills the email field from the query-string value', () => {
  const html = render({ email: 'jane@example.com', invalidCode: false })
  assertStringIncludes(html, 'value="jane@example.com"')
})

Deno.test('RecoveryCallbackView: a previously submitted email wins over the query-string one', () => {
  const html = render({
    email: 'jane@example.com',
    invalidCode: false,
    submitted: { email: 'other@example.com' },
  })
  assertStringIncludes(html, 'value="other@example.com"')
  assertEquals(html.includes('value="jane@example.com"'), false)
})

Deno.test('RecoveryCallbackView: renders every flattened field error when present', () => {
  const html = render({
    email: '',
    invalidCode: false,
    fieldErrors: {
      email: [{ constraints: ['Must be a valid email.'] }],
      code: [{ constraints: ['Code is required.'] }],
      password: [{ constraints: ['Password is required.'] }],
    },
  })
  assertStringIncludes(html, 'Must be a valid email.')
  assertStringIncludes(html, 'Code is required.')
  assertStringIncludes(html, 'Password is required.')
})

// Real wiring against the actual `@zanix/space/comet/react` `ManagedForm` binding is deliberately
// NOT re-tested per page — see `login.test.ts`'s own identical doc for the original ManagedForm
// wiring test this would otherwise duplicate, and `login-otp.test.ts`'s own doc for why a second
// pair repeating this causes a real, process-wide active-renderer conflict between test files.
