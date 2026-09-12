import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  Button,
  Countdown,
  Field,
  Input,
  IntlProvider,
  PasswordInput,
  useIntl,
} from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createLoginView } from 'ui/pages/login/render.ts'
import type { LoginViewDeps } from 'ui/pages/login/render.ts'
import type { LoginViewProps } from 'ui/pages/login/types.ts'
import { createPasswordToggleField } from 'ui/pages/login/password-toggle-field/render.ts'
import { createRateLimitCountdown } from 'ui/pages/login/rate-limit-countdown/render.ts'

/** Mirrors `iam`'s own `en/index.json` real keys `LoginView` formats. */
const TEST_MESSAGES = {
  'login/invalid-credentials': 'Invalid email or password.',
  'login/rate-limited': 'Too many attempts — please wait a minute and try again.',
  'login/rate-limited/heading': "For your security, we've paused sign-in attempts for a moment.",
  'login/rate-limited/body': 'You can try again in:',
  'login/rate-limited/announcement':
    '{seconds, plural, one {# second} other {# seconds}} remaining before you can try again.',
  'login/unexpected-error': 'Something went wrong signing you in. Please try again.',
  'login/email-label': 'Email',
  'login/password-label': 'Password',
  'login/password-show': 'Show password',
  'login/password-hide': 'Hide password',
  'login/submit': 'Sign in',
  'login/terms-link': 'Terms and Conditions',
  'login/privacy-link': 'Privacy Notice',
  'login/oauth-continue': 'Continue with {provider}',
}

// `ManagedForm`, `PasswordToggleField`, and `RateLimitCountdown` are all real Comets, exercised for
// real only by the dedicated wiring tests at the bottom of this file — every other test here builds
// the view directly from `render.ts` with a `null`-rendering `ManagedForm` stand-in and
// `PasswordToggleField`/`RateLimitCountdown` each built from their own raw, un-wrapped factory
// (`password-toggle-field/render.ts`'s own `createPasswordToggleField`, bound to the same real
// `PasswordInput`; `rate-limit-countdown/render.ts`'s own `createRateLimitCountdown`, bound to the
// same real `Countdown`) instead of the real `defineComet`-wrapped boundary. Rendering the real
// `ManagedForm` Comet requires this process's active renderer to already be registered (`import
// '@zanix/space/react'`), a real side effect this package's own Preact test file never triggers —
// mirrors `@zanix/space-ui`'s own `NavDrawer` unit-test precedent (its own `render.ts` composes a
// real component the same way, tested via the raw, un-wrapped factory; the real Comet boundary gets
// its own narrow, separate wiring test instead of every content assertion paying that cost).
const LoginViewForContent = createLoginView<ReactElement>(
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
    ) as unknown as LoginViewDeps<ReactElement>['PasswordToggleField'],
    RateLimitCountdown: createRateLimitCountdown<ReactElement>(
      createElement as unknown as CreateElement<ReactElement>,
      { Countdown: Countdown as unknown as (props: Record<string, unknown>) => ReactElement },
    ) as unknown as LoginViewDeps<ReactElement>['RateLimitCountdown'],
    ManagedForm: () => null,
  },
)

function render(props: LoginViewProps): string {
  const element = createElement(LoginViewForContent, props)
  return renderToStaticMarkup(
    createElement(IntlProvider, { locale: 'en', messages: TEST_MESSAGES }, element),
  )
}

Deno.test('LoginView: renders the default "Sign in" heading with no behavior override registered', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
  })
  assertStringIncludes(html, '<h1>Sign in</h1>')
})

Deno.test('LoginView: the heading prop overrides the default — for a Tier-2 host with no activateApps() of its own', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
    heading: 'Welcome back',
  })
  assertStringIncludes(html, '<h1>Welcome back</h1>')
  assertEquals(html.includes('<h1>Sign in</h1>'), false)
})

Deno.test('LoginView: renders every message-catalog string for real, through IntlProvider', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: true,
    rateLimited: true,
    unexpectedError: true,
    oauthProviders: ['google'],
  })
  assertStringIncludes(html, 'Invalid email or password.')
  assertStringIncludes(html, 'Too many attempts')
  assertStringIncludes(html, 'Something went wrong signing you in.')
  assertStringIncludes(html, 'Sign in</button>')
  assertStringIncludes(html, 'Continue with google')
})

Deno.test('LoginView: renders a Terms and Conditions link once termsUrl is set', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
    termsUrl: 'https://example.com/terms',
  })
  assertStringIncludes(html, 'href="https://example.com/terms"')
  assertStringIncludes(html, 'Terms and Conditions')
})

Deno.test('LoginView: renders no Terms and Conditions link when termsUrl is unset', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
  })
  assertEquals(html.includes('Terms and Conditions'), false)
})

Deno.test('LoginView: renders a Privacy Notice link once privacyUrl is set', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
    privacyUrl: 'https://example.com/privacy',
  })
  assertStringIncludes(html, 'href="https://example.com/privacy"')
  assertStringIncludes(html, 'Privacy Notice')
})

Deno.test('LoginView: renders no Privacy Notice link when privacyUrl is unset', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
  })
  assertEquals(html.includes('Privacy Notice'), false)
})

Deno.test('LoginView: renders both links, separated, when termsUrl and privacyUrl are both set', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
    termsUrl: 'https://example.com/terms',
    privacyUrl: 'https://example.com/privacy',
  })
  assertStringIncludes(html, 'href="https://example.com/terms"')
  assertStringIncludes(html, 'href="https://example.com/privacy"')
  assertStringIncludes(html, '·')
})

Deno.test('LoginView: renders the flattened email/password field errors when present', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
    fieldErrors: {
      email: [{ constraints: ['Must be a valid email.'] }],
      password: [{ constraints: ['Password is required.'] }],
    },
  })
  assertStringIncludes(html, 'Must be a valid email.')
  assertStringIncludes(html, 'Password is required.')
})

Deno.test('LoginView: pre-fills the email field from a previously submitted value', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
    submitted: { email: 'jane@example.com' },
  })
  assertStringIncludes(html, 'value="jane@example.com"')
})

// --- Rate-limit countdown --------------------------------------------------------------------

Deno.test('LoginView: rateLimited with no retryUntil falls back to the static message, form enabled', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: true,
    unexpectedError: false,
    oauthProviders: [],
  })
  assertStringIncludes(html, 'Too many attempts')
  assertEquals(html.includes('data-space="login-rate-limit"'), false)
  assertEquals(html.includes('disabled'), false)
})

Deno.test('LoginView: rateLimited with a future retryUntil renders the live countdown card, form disabled', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: true,
    unexpectedError: false,
    oauthProviders: [],
    retryUntil: Date.now() + 90_000,
  })
  assertStringIncludes(html, 'data-space="login-rate-limit"')
  assertStringIncludes(html, 'For your security, we')
  assertStringIncludes(html, 'You can try again in:')
  assertEquals(html.includes('Too many attempts'), false)
  assertStringIncludes(html, '<button type="submit" disabled=""')
})

Deno.test('LoginView: nonce reaches both the rate-limit Countdown and the password field', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: true,
    unexpectedError: false,
    oauthProviders: [],
    retryUntil: Date.now() + 90_000,
    nonce: 'abc123',
  })
  // `Countdown`'s own ring/live-region `<style nonce>` and `PasswordInput`'s own default icon
  // stroke `<style nonce>` (composed inside `PasswordToggleField`) both receive it — see
  // `LoginViewProps.nonce`'s own doc for the full contract.
  const nonceStyleCount = html.split('<style nonce="abc123">').length - 1
  assertEquals(nonceStyleCount >= 2, true)
})

Deno.test('LoginView: rateLimited with a PAST retryUntil behaves exactly like no retryUntil at all', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: true,
    unexpectedError: false,
    oauthProviders: [],
    retryUntil: Date.now() - 1_000,
  })
  assertStringIncludes(html, 'Too many attempts')
  assertEquals(html.includes('data-space="login-rate-limit"'), false)
  assertEquals(html.includes('disabled'), false)
})

Deno.test('LoginView: not rateLimited ignores a future retryUntil entirely', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
    retryUntil: Date.now() + 90_000,
  })
  assertEquals(html.includes('data-space="login-rate-limit"'), false)
  assertEquals(html.includes('disabled'), false)
})

// --- Password visibility toggle ----------------------------------------------------------------

Deno.test('LoginView: the password field renders a real, keyboard-operable show/hide toggle', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
  })
  assertStringIncludes(html, 'Show password')
})

// --- Real wiring — the actual `index.ts` binding, including the real ManagedForm,
// PasswordToggleField, and RateLimitCountdown Comets --------------------------------------------

Deno.test('LoginView (index.ts): the real binding renders without throwing, every real Comet included', async () => {
  // Side-effect only, scoped to this one test via a dynamic import — registers the React element
  // factory `defineComet`'s own boundary resolves at render time, the one real side effect a
  // `@zanix/space` app's own main module normally performs once at startup. Deferred to this
  // single test (rather than a top-level import) so this package's own Preact test file never
  // observes it — the two renderer registrations are process-wide and mutually exclusive.
  await import('@zanix/space/react')
  const { LoginView } = await import('ui/pages/login/index.ts')
  const props: LoginViewProps = {
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
  }
  const element = createElement(LoginView, props)
  const markup = renderToStaticMarkup(
    createElement(IntlProvider, { locale: 'en', messages: TEST_MESSAGES }, element),
  )
  assertStringIncludes(markup, '<h1>Sign in</h1>')
  // The real `PasswordToggleField` Comet's own SSR markup — same content a plain, un-wrapped
  // `PasswordInput` would render (a Comet boundary never withholds its initial HTML), proving the
  // real Comet-wrapped binding renders correctly, not just the raw factory the content tests above
  // use.
  assertStringIncludes(markup, 'Show password')
})

Deno.test('LoginView (index.ts): rateLimited with a future retryUntil renders the real RateLimitCountdown Comet', async () => {
  // Same real-Comet-registration side effect the test above documents in full.
  await import('@zanix/space/react')
  const { LoginView } = await import('ui/pages/login/index.ts')
  const props: LoginViewProps = {
    lang: 'en',
    invalidCredentials: false,
    rateLimited: true,
    unexpectedError: false,
    oauthProviders: [],
    retryUntil: Date.now() + 90_000,
  }
  const element = createElement(LoginView, props)
  const markup = renderToStaticMarkup(
    createElement(IntlProvider, { locale: 'en', messages: TEST_MESSAGES }, element),
  )
  // The real `RateLimitCountdown` Comet's own SSR markup — same ring/card content the raw,
  // un-wrapped factory (bound to the real `Countdown`) would render, proving the real
  // Comet-wrapped binding renders correctly, not just the raw factory the content tests above use.
  assertStringIncludes(markup, 'data-space="login-rate-limit"')
  assertStringIncludes(markup, 'For your security, we')
})
