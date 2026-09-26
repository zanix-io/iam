import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button, Field, Input, IntlProvider, useIntl } from '@zanix/space-ui'
import { authHiddenFields } from 'ui/components/auth-hidden-fields/index.ts'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createOtpView } from 'ui/pages/login-otp/render.ts'
import type { OtpViewProps } from 'ui/pages/login-otp/types.ts'

const TEST_MESSAGES = {
  'login/otp/heading': 'Enter your verification code',
  'login/otp/sent-to': 'A verification code was sent for {email}.',
  'login/otp/code-label': 'Verification code',
  'login/otp/resend': "Didn't get it? Resend code",
  'login/otp/resend-cooldown': 'We already sent you a code.',
  'login/otp/resend-notifier-label': 'Send by',
  'login/otp/notifier-email': 'Email',
  'login/otp/notifier-sms': 'SMS',
  'login/otp/notifier-whatsapp': 'WhatsApp',
  'common/invalid-or-expired-code': 'Invalid or expired code.',
  'common/verify': 'Verify',
  'common/back-to-sign-in': 'Back to sign in',
}

// `SubmitGuard`/`OtpResend` are exercised for real, against their own actual Comet bindings, only
// by dedicated wiring tests elsewhere — see `login.test.ts`'s own identical doc for why a plain
// stub is the right call in a content-only render test like this one.
const OtpViewForContent = createOtpView<ReactElement>(
  createElement as unknown as CreateElement<ReactElement>,
  {
    useIntl,
    Button,
    Field,
    Input,
    SubmitGuard: () => null,
    authHiddenFields,
    OtpResend: () => null,
  },
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
  // The banner carries the `[data-space='banner']` styling hook (see `login-totp.test.ts`).
  assertStringIncludes(html, 'data-space="banner" data-variant="error"')
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

Deno.test('OtpView: links back to the sign-in page', () => {
  const html = render({ lang: 'fr', email: 'jane@example.com', invalidCode: false })
  assertStringIncludes(html, 'href="/fr/login"')
  assertStringIncludes(html, 'Back to sign in')
  // The back link carries its `data-space` styling hook (see `login-oauth-callback-error.test.ts`).
  assertStringIncludes(html, 'data-space="auth-back-link"')
})

Deno.test('OtpView: carries the email as a hidden field for the action to read back', () => {
  const html = render({ lang: 'en', email: 'jane@example.com', invalidCode: false })
  assertStringIncludes(html, 'name="email" value="jane@example.com"')
})

Deno.test(
  'OtpView: with a verified phone, offers every deliverable channel — current one included — resolved from otpNotifier/hasVerifiedPhone',
  () => {
    let capturedProps: Record<string, unknown> | undefined
    const OtpViewCapturing = createOtpView<ReactElement>(
      createElement as unknown as CreateElement<ReactElement>,
      {
        useIntl,
        Button,
        Field,
        Input,
        SubmitGuard: () => null,
        authHiddenFields,
        OtpResend: (props) => {
          capturedProps = props
          return null
        },
      },
    )
    renderToStaticMarkup(
      createElement(
        IntlProvider,
        { locale: 'en', messages: TEST_MESSAGES },
        createElement(OtpViewCapturing, {
          lang: 'en',
          email: 'jane@example.com',
          invalidCode: false,
          otpNotifier: 'sms',
          hasVerifiedPhone: true,
        }),
      ),
    )
    assertEquals(
      capturedProps?.notifierOptions,
      [{ value: 'email', label: 'Email' }, { value: 'sms', label: 'SMS' }, {
        value: 'whatsapp',
        label: 'WhatsApp',
      }],
    )
    assertEquals(capturedProps?.currentNotifier, 'sms')
    assertEquals(capturedProps?.notifierPickerLabel, 'Send by')
  },
)

Deno.test(
  'OtpView: no verified phone at all resolves a single-entry notifierOptions — OtpResend renders no picker either way',
  () => {
    let capturedProps: Record<string, unknown> | undefined
    const OtpViewCapturing = createOtpView<ReactElement>(
      createElement as unknown as CreateElement<ReactElement>,
      {
        useIntl,
        Button,
        Field,
        Input,
        SubmitGuard: () => null,
        authHiddenFields,
        OtpResend: (props) => {
          capturedProps = props
          return null
        },
      },
    )
    renderToStaticMarkup(
      createElement(
        IntlProvider,
        { locale: 'en', messages: TEST_MESSAGES },
        createElement(OtpViewCapturing, {
          lang: 'en',
          email: 'jane@example.com',
          invalidCode: false,
          hasVerifiedPhone: false,
        }),
      ),
    )
    assertEquals(capturedProps?.notifierOptions, [{ value: 'email', label: 'Email' }])
    assertEquals(capturedProps?.currentNotifier, 'email')
  },
)

// Real wiring against the actual `@zanix/space/comet/react` `SubmitGuard` binding is deliberately
// NOT re-tested per page — `login.test.ts`/`login-preact.test.ts` already exercise the identical
// `defineComet`/`CometBoundary` element-factory mechanism for real (via `ManagedForm`, a sibling
// Comet going through the exact same wiring); the active-renderer registration those tests trigger
// is process-wide, so a second pair repeating it here would fight the first for which renderer
// stays "active" depending on file execution order.

Deno.test('OtpView: a code error entry with no constraints renders no error text', () => {
  const props = { lang: 'en', email: 'jane@example.com', invalidCode: false }
  assertEquals(render({ ...props, fieldErrors: { code: [{}] } }), render(props))
})
