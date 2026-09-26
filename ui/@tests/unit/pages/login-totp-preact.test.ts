import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { h } from 'preact'
import type { VNode } from 'preact'
import { render as renderToString } from 'preact-render-to-string'
import { Button, Countdown, Field, Input, IntlProvider, useIntl } from '@zanix/space-ui/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createTotpLoginView } from 'ui/pages/login-totp/render.ts'
import type { TotpViewDeps } from 'ui/pages/login-totp/render.ts'
import type { TotpViewProps } from 'ui/pages/login-totp/types.ts'
import { createRateLimitCountdown } from 'ui/components/rate-limit-countdown/render.ts'
import { createRateLimitCard } from 'ui/components/rate-limit-card/render.ts'
import { authHiddenFields } from 'ui/components/auth-hidden-fields/index.preact.ts'

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
// against the actual `@zanix/space/comet/preact` binding, only by the dedicated wiring test below
// — see `login.test.ts`'s own identical doc for why.
const TotpLoginViewForContent = createTotpLoginView<VNode>(
  h as unknown as CreateElement<VNode>,
  {
    useIntl,
    Button,
    Field,
    Input,
    SubmitGuard: () => null,
    RateLimitCard: createRateLimitCard<VNode>(
      h as unknown as CreateElement<VNode>,
      {
        RateLimitCountdown: createRateLimitCountdown<VNode>(
          h as unknown as CreateElement<VNode>,
          { Countdown: Countdown as unknown as (props: Record<string, unknown>) => VNode },
        ) as unknown as (props: Record<string, unknown>) => VNode,
      },
    ) as unknown as TotpViewDeps<VNode>['RateLimitCard'],
    authHiddenFields,
  },
)

function render(props: TotpViewProps): string {
  return renderToString(
    h(
      IntlProvider,
      { locale: 'en', messages: TEST_MESSAGES },
      h(TotpLoginViewForContent, props),
    ),
  )
}

Deno.test('TotpLoginView (preact): renders the heading and the account being signed into', () => {
  const html = render({ ...BASE_PROPS, lang: 'en', email: 'jane@example.com', invalidCode: false })
  assertStringIncludes(html, '<h1>Enter your authenticator code</h1>')
  assertStringIncludes(html, 'Signing in as jane@example.com.')
})

Deno.test('TotpLoginView (preact): links back to the sign-in page', () => {
  const html = render({ ...BASE_PROPS, lang: 'fr', email: 'jane@example.com', invalidCode: false })
  assertStringIncludes(html, 'href="/fr/login"')
  assertStringIncludes(html, 'Back to sign in')
  // Same `data-space` back-link styling hook the non-preact test asserts.
  assertStringIncludes(html, 'data-space="auth-back-link"')
})

Deno.test('TotpLoginView (preact): rateLimited with no retryUntil falls back to the static message', () => {
  const html = render({
    ...BASE_PROPS,
    lang: 'en',
    email: 'jane@example.com',
    invalidCode: false,
    rateLimited: true,
  })
  assertStringIncludes(html, 'Too many attempts — please wait a minute and try again.')
  assertEquals(html.includes('data-space="login-totp-rate-limit"'), false)
})

Deno.test('TotpLoginView (preact): rateLimited with a future retryUntil renders the live countdown card', () => {
  const html = render({
    ...BASE_PROPS,
    lang: 'en',
    email: 'jane@example.com',
    invalidCode: false,
    rateLimited: true,
    retryUntil: Date.now() + 60_000,
  })
  assertStringIncludes(html, 'data-space="login-totp-rate-limit"')
  assertStringIncludes(html, 'disabled')
})

// Real wiring against the actual `@zanix/space/comet/preact` `SubmitGuard` binding is deliberately
// NOT re-tested per page — see `login-otp.test.ts`'s own identical doc for why (the process-wide
// active-renderer conflict this would otherwise cause between test files).
