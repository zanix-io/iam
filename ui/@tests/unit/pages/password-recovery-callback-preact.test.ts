import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { h } from 'preact'
import type { VNode } from 'preact'
import { render as renderToString } from 'preact-render-to-string'
import { Button, Field, Input, IntlProvider, PasswordInput, useIntl } from '@zanix/space-ui/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createRecoveryCallbackView } from 'ui/pages/password-recovery-callback/render.ts'
import type { RecoveryCallbackViewDeps } from 'ui/pages/password-recovery-callback/render.ts'
import type { RecoveryCallbackViewProps } from 'ui/pages/password-recovery-callback/types.ts'
import { createPasswordToggleField } from 'ui/components/password-toggle-field/render.ts'

const TEST_MESSAGES = {
  'password/recovery/callback-heading': 'Reset your password',
  'common/invalid-or-expired-code': 'Invalid or expired code.',
  'password/recovery/mismatch': "The passwords don't match.",
  'login/email-label': 'Email',
  'password/recovery/code-label': 'Recovery code',
  'password/recovery/password-label': 'New password',
  'password/recovery/confirm-label': 'Confirm password',
  'password/recovery/password-show': 'Show password',
  'password/recovery/password-hide': 'Hide password',
  'password/recovery/submit': 'Reset password',
}

// `ManagedForm`/`PasswordToggleField` — `PasswordToggleField` built from its own raw, un-wrapped
// factory (bound to the same real `PasswordInput`) rather than the real `defineComet`-wrapped
// boundary — see `login-preact.test.ts`'s own identical doc for the full reasoning; `ManagedForm`
// is exercised for real, against the actual `@zanix/space/comet/preact` binding, only by the
// dedicated wiring test below.
const RecoveryCallbackViewForContent = createRecoveryCallbackView<VNode>(
  h as unknown as CreateElement<VNode>,
  {
    useIntl,
    Button,
    Field,
    Input,
    PasswordToggleField: createPasswordToggleField<VNode>(
      h as unknown as CreateElement<VNode>,
      { PasswordInput: PasswordInput as unknown as (props: Record<string, unknown>) => VNode },
    ) as unknown as RecoveryCallbackViewDeps<VNode>['PasswordToggleField'],
    ManagedForm: () => null,
  },
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
  const html = render({ email: '', invalidCode: false, mismatch: false, emailLocked: false })
  assertStringIncludes(html, '<h1>Reset your password</h1>')
})

Deno.test('RecoveryCallbackView (preact): renders the mismatch banner only when mismatch is true', () => {
  const html = render({ email: '', invalidCode: false, mismatch: true, emailLocked: false })
  assertStringIncludes(html, "The passwords don't match.")
  assertEquals(
    render({ email: '', invalidCode: false, mismatch: false, emailLocked: false }).includes(
      "don't match",
    ),
    false,
  )
})

Deno.test('RecoveryCallbackView (preact): renders a confirm-password field alongside the new-password one', () => {
  const html = render({ email: '', invalidCode: false, mismatch: false, emailLocked: false })
  assertStringIncludes(html, 'name="password"')
  assertStringIncludes(html, 'name="confirmPassword"')
})

Deno.test('RecoveryCallbackView (preact): pre-fills the email field from the query-string value', () => {
  const html = render({
    email: 'jane@example.com',
    invalidCode: false,
    mismatch: false,
    emailLocked: false,
  })
  assertStringIncludes(html, 'value="jane@example.com"')
})

Deno.test('RecoveryCallbackView (preact): locks the email field readOnly when emailLocked is true, editable otherwise', () => {
  const locked = render({
    email: 'jane@example.com',
    invalidCode: false,
    mismatch: false,
    emailLocked: true,
  })
  assertStringIncludes(locked, 'readonly')
  const editable = render({
    email: 'jane@example.com',
    invalidCode: false,
    mismatch: false,
    emailLocked: false,
  })
  assertEquals(editable.includes('readonly'), false)
})

// Real wiring against the actual `@zanix/space/comet/preact` `ManagedForm` binding is deliberately
// NOT re-tested per page — see `login-preact.test.ts`'s own identical doc for the original
// ManagedForm wiring test this would otherwise duplicate, and `login-otp.test.ts`'s own doc for
// why a second pair repeating this causes a real, process-wide active-renderer conflict between
// test files.
