import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button, Countdown, Field, Input, IntlProvider, useIntl } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createTotpLoginView } from 'ui/pages/login-totp/render.ts'
import type { TotpViewDeps } from 'ui/pages/login-totp/render.ts'
import type { TotpViewProps } from 'ui/pages/login-totp/types.ts'
import { createRateLimitCountdown } from 'ui/components/rate-limit-countdown/render.ts'
import { createRateLimitCard } from 'ui/components/rate-limit-card/render.ts'
import { authHiddenFields } from 'ui/components/auth-hidden-fields/index.ts'

const TEST_MESSAGES = {
  'login/totp/heading': 'Enter your authenticator code',
  'login/totp/signing-in-as': 'Signing in as {email}.',
  'login/totp/code-label': 'Authenticator code',
  'login/totp/invalid-code': 'Invalid authenticator code.',
  'login/totp/rate-limited': 'Too many attempts — please wait a minute and try again.',
  'login/totp/rate-limited/heading':
    "For your security, we've paused sign-in attempts for a moment.",
  'login/totp/rate-limited/body': 'You can try again in:',
  'login/totp/unexpected-error': 'Something went wrong verifying your code. Please try again.',
  'common/verify': 'Verify',
  'common/back-to-sign-in': 'Back to sign in',
}

const BASE_PROPS = { rateLimited: false, unexpectedError: false } as const

// `SubmitGuard`/`RateLimitCountdown` (composed inside `RateLimitCard`) are exercised for real,
// against the actual `@zanix/space/comet/react` binding, only by the dedicated wiring test below —
// see `login.test.ts`'s own identical doc for why (a `null`-rendering `SubmitGuard` stand-in, and
// `RateLimitCard` built from its own raw, un-wrapped factory bound to the same real `Countdown`,
// everywhere else here).
const TotpLoginViewForContent = createTotpLoginView<ReactElement>(
  createElement as unknown as CreateElement<ReactElement>,
  {
    useIntl,
    Button,
    Field,
    Input,
    SubmitGuard: () => null,
    RateLimitCard: createRateLimitCard<ReactElement>(
      createElement as unknown as CreateElement<ReactElement>,
      {
        RateLimitCountdown: createRateLimitCountdown<ReactElement>(
          createElement as unknown as CreateElement<ReactElement>,
          { Countdown: Countdown as unknown as (props: Record<string, unknown>) => ReactElement },
        ) as unknown as (props: Record<string, unknown>) => ReactElement,
      },
    ) as unknown as TotpViewDeps<ReactElement>['RateLimitCard'],
    authHiddenFields,
  },
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
  const html = render({ ...BASE_PROPS, lang: 'en', email: 'jane@example.com', invalidCode: false })
  assertStringIncludes(html, '<h1>Enter your authenticator code</h1>')
  assertStringIncludes(html, 'Signing in as jane@example.com.')
})

Deno.test('TotpLoginView: renders the invalid-code banner only when invalidCode is true', () => {
  const html = render({ ...BASE_PROPS, lang: 'en', email: 'jane@example.com', invalidCode: true })
  assertStringIncludes(html, 'Invalid authenticator code.')
  // The invalid-code banner carries `[data-space='banner']`, the hook a consumer theme styles
  // banners by — as do the sibling pages (`login-otp`, `password-recovery-callback`,
  // `totp-enroll`).
  assertStringIncludes(html, 'data-space="banner" data-variant="error"')
})

Deno.test('TotpLoginView: links back to the sign-in page', () => {
  const html = render({ ...BASE_PROPS, lang: 'fr', email: 'jane@example.com', invalidCode: false })
  assertStringIncludes(html, 'href="/fr/login"')
  assertStringIncludes(html, 'Back to sign in')
  // The back link carries its `data-space` styling hook (see `login-oauth-callback-error.test.ts`).
  assertStringIncludes(html, 'data-space="auth-back-link"')
})

Deno.test('TotpLoginView: renders the flattened code field error when present', () => {
  const html = render({
    ...BASE_PROPS,
    lang: 'en',
    email: 'jane@example.com',
    invalidCode: false,
    fieldErrors: { code: [{ constraints: ['Must be 6 digits.'] }] },
  })
  assertStringIncludes(html, 'Must be 6 digits.')
})

/** `TotpViewProps.rateLimited`/`retryUntil` let a `429` from the owning page's `action` render on
 * this screen instead of escaping to the host app's generic `onError` chain (see `render.ts`). */
Deno.test('TotpLoginView: rateLimited with no retryUntil renders the static fallback message, form left enabled', () => {
  const html = render({
    ...BASE_PROPS,
    lang: 'en',
    email: 'jane@example.com',
    invalidCode: false,
    rateLimited: true,
  })
  assertStringIncludes(html, 'Too many attempts — please wait a minute and try again.')
  assertStringIncludes(html, 'data-space="banner" data-variant="warn"')
  assertEquals(html.includes('disabled'), false)
})

Deno.test('TotpLoginView: rateLimited with a live retryUntil renders the countdown card, form disabled', () => {
  const html = render({
    ...BASE_PROPS,
    lang: 'en',
    email: 'jane@example.com',
    invalidCode: false,
    rateLimited: true,
    retryUntil: Date.now() + 60_000,
  })
  // React's own `renderToStaticMarkup` HTML-entity-escapes `'` as `&#x27;` in text content —
  // `preact-render-to-string` doesn't (see the preact test's own identical assertion, unescaped).
  assertStringIncludes(html, 'For your security, we&#x27;ve paused sign-in attempts for a moment.')
  assertStringIncludes(html, 'You can try again in:')
  assertStringIncludes(html, 'data-space="login-totp-rate-limit"')
  assertStringIncludes(html, 'disabled')
})

Deno.test('TotpLoginView: rateLimited with an already-past retryUntil falls back to the static message', () => {
  const html = render({
    ...BASE_PROPS,
    lang: 'en',
    email: 'jane@example.com',
    invalidCode: false,
    rateLimited: true,
    retryUntil: Date.now() - 1000,
  })
  assertStringIncludes(html, 'Too many attempts — please wait a minute and try again.')
  assertEquals(html.includes('data-space="login-totp-rate-limit"'), false)
})

Deno.test('TotpLoginView: renders the unexpected-error banner only when unexpectedError is true', () => {
  const html = render({
    ...BASE_PROPS,
    lang: 'en',
    email: 'jane@example.com',
    invalidCode: false,
    unexpectedError: true,
  })
  assertStringIncludes(html, 'Something went wrong verifying your code. Please try again.')
})

// Real wiring against the actual `@zanix/space/comet/react` `SubmitGuard` binding is deliberately
// NOT re-tested per page — see `login-otp.test.ts`'s own identical doc for why (the process-wide
// active-renderer conflict this would otherwise cause between test files).

Deno.test('TotpLoginView: a code error entry with no constraints renders no error text', () => {
  const props = { ...BASE_PROPS, lang: 'en', email: 'jane@example.com', invalidCode: false }
  assertEquals(render({ ...props, fieldErrors: { code: [{}] } }), render(props))
})
