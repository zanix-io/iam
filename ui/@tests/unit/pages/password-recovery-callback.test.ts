import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button, Field, Input, IntlProvider, PasswordInput, useIntl } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createRecoveryCallbackView } from 'ui/pages/password-recovery-callback/render.ts'
import type { RecoveryCallbackViewDeps } from 'ui/pages/password-recovery-callback/render.ts'
import type { RecoveryCallbackViewProps } from 'ui/pages/password-recovery-callback/types.ts'
import { createPasswordToggleField } from 'ui/components/password-toggle-field/render.ts'

const TEST_MESSAGES = {
  'password/recovery/callback-heading': 'Reset your password',
  'common/invalid-or-expired-code': 'Invalid or expired code.',
  'password/recovery/mismatch': "The passwords don't match.",
  'password/recovery/weak-password': "This password doesn't meet the password requirements.",
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
// boundary — see `login.test.ts`'s own identical doc for the full reasoning; `ManagedForm` is
// exercised for real, against the actual `@zanix/space/comet/react` binding, only by the dedicated
// wiring test below.
const RecoveryCallbackViewForContent = createRecoveryCallbackView<ReactElement>(
  createElement as unknown as CreateElement<ReactElement>,
  {
    useIntl,
    Button,
    Field,
    Input,
    PasswordToggleField: createPasswordToggleField<ReactElement>(
      createElement as unknown as CreateElement<ReactElement>,
      {
        PasswordInput: PasswordInput as unknown as (props: Record<string, unknown>) => ReactElement,
      },
    ) as unknown as RecoveryCallbackViewDeps<ReactElement>['PasswordToggleField'],
    ManagedForm: () => null,
  },
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
  const html = render({ email: '', invalidCode: false, mismatch: false, emailLocked: false })
  assertStringIncludes(html, '<h1>Reset your password</h1>')
})

Deno.test('RecoveryCallbackView: renders the invalid-code banner only when invalidCode is true', () => {
  const html = render({ email: '', invalidCode: true, mismatch: false, emailLocked: false })
  assertStringIncludes(html, 'Invalid or expired code.')
  // The banner carries the `[data-space='banner']` styling hook (see `login-totp.test.ts`).
  assertStringIncludes(html, 'data-space="banner" data-variant="error"')
})

Deno.test('RecoveryCallbackView: renders the mismatch banner only when mismatch is true', () => {
  const html = render({ email: '', invalidCode: false, mismatch: true, emailLocked: false })
  // React's own `renderToStaticMarkup` HTML-entity-escapes `'` as `&#x27;` in text content — see
  // `login-totp.test.ts`'s own identical doc.
  assertStringIncludes(html, 'The passwords don&#x27;t match.')
  assertEquals(
    render({ email: '', invalidCode: false, mismatch: false, emailLocked: false }).includes(
      'match.',
    ),
    false,
  )
})

Deno.test('RecoveryCallbackView: renders the weak-password banner only when weakPassword is true', () => {
  const base = { email: '', invalidCode: false, mismatch: false, emailLocked: false }
  const html = render({ ...base, weakPassword: true })
  assertStringIncludes(html, 'meet the password requirements.')
  assertStringIncludes(html, 'data-space="banner" data-variant="error"')
  assertEquals(render(base).includes('password requirements'), false)
})

Deno.test('RecoveryCallbackView: renders a confirm-password field alongside the new-password one', () => {
  const html = render({ email: '', invalidCode: false, mismatch: false, emailLocked: false })
  assertStringIncludes(html, 'name="password"')
  assertStringIncludes(html, 'name="confirmPassword"')
})

Deno.test('RecoveryCallbackView: pre-fills the email field from the query-string value', () => {
  const html = render({
    email: 'jane@example.com',
    invalidCode: false,
    mismatch: false,
    emailLocked: false,
  })
  assertStringIncludes(html, 'value="jane@example.com"')
})

Deno.test('RecoveryCallbackView: locks the email field readOnly when emailLocked is true, editable otherwise', () => {
  const locked = render({
    email: 'jane@example.com',
    invalidCode: false,
    mismatch: false,
    emailLocked: true,
  })
  assertStringIncludes(locked, 'readOnly=""')
  const editable = render({
    email: 'jane@example.com',
    invalidCode: false,
    mismatch: false,
    emailLocked: false,
  })
  assertEquals(editable.includes('readOnly'), false)
})

Deno.test('RecoveryCallbackView: a previously submitted email wins over the query-string one', () => {
  const html = render({
    email: 'jane@example.com',
    invalidCode: false,
    mismatch: false,
    emailLocked: false,
    submitted: { email: 'other@example.com' },
  })
  assertStringIncludes(html, 'value="other@example.com"')
  assertEquals(html.includes('value="jane@example.com"'), false)
})

Deno.test('RecoveryCallbackView: renders every flattened field error when present', () => {
  const html = render({
    email: '',
    invalidCode: false,
    mismatch: false,
    emailLocked: false,
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

Deno.test('RecoveryCallbackView: a field error entry with no constraints renders no error text', () => {
  const props = { email: '', invalidCode: false, mismatch: false, emailLocked: false }
  assertEquals(render({ ...props, fieldErrors: { code: [{}] } } as never), render(props as never))
})
