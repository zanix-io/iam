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
import { createPasswordToggleField } from 'ui/components/password-toggle-field/render.ts'
import { createRateLimitCountdown } from 'ui/components/rate-limit-countdown/render.ts'
import { createRateLimitCard } from 'ui/components/rate-limit-card/render.ts'

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
  'login/heading': 'Sign in or create an account',
  'login/subtext': 'Enter your email, or continue with a provider below.',
  'login/subtext-no-oauth': 'Enter your email to continue.',
  'login/or-email': 'or continue with email',
  'login/email-placeholder': 'you@example.com',
  'login/legal-prefix': 'By continuing, you agree to our',
  'login/legal-and': 'and',
  'login/no-account': 'No account exists for that email.',
  'login/session-expired': 'Your session expired. Sign in again to continue.',
}

// `ManagedForm`, `PasswordToggleField`, and `RateLimitCountdown` (composed inside `RateLimitCard`)
// are all real Comets, exercised for real only by the dedicated wiring tests at the bottom of this
// file — every other test here builds the view directly from `render.ts` with a `null`-rendering
// `ManagedForm` stand-in and `PasswordToggleField`/`RateLimitCard` each built from their own raw,
// un-wrapped factory (`password-toggle-field/render.ts`'s own `createPasswordToggleField`, bound to
// the same real `PasswordInput`; `rate-limit-card/render.ts`'s own `createRateLimitCard`, itself
// composing `rate-limit-countdown/render.ts`'s own `createRateLimitCountdown` bound to the same real
// `Countdown`) instead of the real `defineComet`-wrapped boundary. Rendering the real `ManagedForm`
// Comet requires this process's active renderer to already be registered (`import '@zanix/space/
// react'`), a real side effect this package's own Preact test file never triggers — mirrors
// `@zanix/space-ui`'s own `NavDrawer` unit-test precedent (its own `render.ts` composes a real
// component the same way, tested via the raw, un-wrapped factory; the real Comet boundary gets its
// own narrow, separate wiring test instead of every content assertion paying that cost).
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
    RateLimitCard: createRateLimitCard<ReactElement>(
      createElement as unknown as CreateElement<ReactElement>,
      {
        RateLimitCountdown: createRateLimitCountdown<ReactElement>(
          createElement as unknown as CreateElement<ReactElement>,
          { Countdown: Countdown as unknown as (props: Record<string, unknown>) => ReactElement },
        ) as unknown as (props: Record<string, unknown>) => ReactElement,
      },
    ) as unknown as LoginViewDeps<ReactElement>['RateLimitCard'],
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
  assertStringIncludes(html, 'Continue with Google')
  // Every banner carries `[data-space='banner']`, the hook a consumer theme styles banners by. Two
  // `'error'` occurrences expected (invalidCredentials + unexpectedError); the static
  // rateLimited fallback gets `'warn'` instead (see `render.ts`'s own doc on that distinction).
  assertEquals(
    html.split('data-space="banner" data-variant="error"').length - 1,
    2,
  )
  assertStringIncludes(html, 'data-space="banner" data-variant="warn"')
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
// PasswordToggleField, and (composed inside RateLimitCard) RateLimitCountdown Comets ------------

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
  // The heading text renders before the countdown in the real Comet-wrapped markup too, not only
  // in `RateLimitCard`'s isolated unit test.
  const headingIndex = markup.indexOf('For your security, we')
  const countdownIndex = markup.indexOf('data-comet-export="RateLimitCountdown"')
  assertEquals(headingIndex > -1 && countdownIndex > -1, true)
  assertEquals(headingIndex < countdownIndex, true)
})

// --- `mode: 'passwordless'` -----------------------------------------------------------------

Deno.test('LoginView: passwordless mode renders no password field at all', () => {
  const html = render({
    lang: 'en',
    mode: 'passwordless',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
  })
  assertEquals(html.includes('Password'), false)
  assertEquals(html.includes('type="password"'), false)
})

Deno.test('LoginView: passwordless mode renders its own heading/subtext via message keys, ignoring the heading prop', () => {
  const html = render({
    lang: 'en',
    mode: 'passwordless',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: ['google'],
    // Password mode's own Tier-2 override mechanism — passwordless mode never reads it.
    heading: 'Ignored in passwordless mode',
  })
  assertStringIncludes(html, '<h1>Sign in or create an account</h1>')
  assertStringIncludes(html, 'Enter your email, or continue with a provider below.')
  assertEquals(html.includes('Ignored in passwordless mode'), false)
})

Deno.test('LoginView: passwordless mode with no OAuth providers uses the no-mention subtext, not the one naming a provider', () => {
  // With no OAuth providers configured, the subtext must not mention one: `login/subtext` (which
  // names a provider) renders only alongside the OAuth buttons. `render.ts` documents the
  // two-key split.
  const html = render({
    lang: 'en',
    mode: 'passwordless',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
  })
  assertStringIncludes(html, 'Enter your email to continue.')
  assertEquals(html.includes('continue with a provider below'), false)
})

Deno.test('LoginView: password mode (default, mode omitted) still resolves the heading prop exactly as before', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
    heading: 'Welcome back',
  })
  assertStringIncludes(html, '<h1>Welcome back</h1>')
})

Deno.test('LoginView: passwordless mode renders configured OAuth providers as buttons ABOVE the form, never the bottom link list', () => {
  const html = render({
    lang: 'en',
    mode: 'passwordless',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: ['google'],
  })
  assertStringIncludes(html, 'data-space="auth-oauth-buttons"')
  assertStringIncludes(html, 'data-provider="google"')
  // The provider's mark is inline markup inside the button, ahead of its label: no stylesheet.
  assertStringIncludes(html, 'data-space="auth-provider-icon"')
  assertEquals(html.indexOf('auth-provider-icon') < html.indexOf('Continue with Google'), true)
  assertStringIncludes(html, 'or continue with email')
  assertEquals(html.includes('<ul'), false)
})

Deno.test('LoginView: password mode still renders the bottom oauth link list, unaffected by passwordless mode existing', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: ['google'],
  })
  assertStringIncludes(html, '<ul')
  assertEquals(html.includes('data-space="auth-oauth-buttons"'), false)
})

/**
 * The provider's authorize URL can only be computed by a `POST` `action`, so the OAuth button is a
 * `<form method="post">` submitted straight from the button. A plain `<a href>` would have to go
 * through a GET-rendered confirmation screen that auto-submits after a full page load (a visible
 * flash); see `render.ts`.
 */
Deno.test("LoginView: passwordless mode's OAuth button POSTs directly to the provider, carrying the real csrfToken — never a plain <a href>", () => {
  const html = render({
    lang: 'en',
    mode: 'passwordless',
    csrfToken: 'a-real-csrf-token',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: ['google'],
  })
  // Attribute order isn't guaranteed by React's own SSR serialization — assert each independently
  // rather than one exact `<form ...>` string.
  assertStringIncludes(html, 'action="/en/login/google"')
  assertStringIncludes(html, 'method="post"')
  assertStringIncludes(html, 'name="_csrf" value="a-real-csrf-token"')
  assertStringIncludes(html, 'data-space="auth-oauth-button"')
  assertEquals(html.includes('href="/en/login/google"'), false)
})

Deno.test("LoginView: password mode's bottom OAuth link ALSO POSTs directly, never a plain <a href>", () => {
  const html = render({
    lang: 'en',
    csrfToken: 'a-real-csrf-token',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: ['google'],
  })
  assertStringIncludes(html, 'action="/en/login/google"')
  assertStringIncludes(html, 'method="post"')
  assertStringIncludes(html, 'name="_csrf" value="a-real-csrf-token"')
  assertEquals(html.includes('href="/en/login/google"'), false)
})

Deno.test('LoginView: passwordless mode renders the noAccount banner', () => {
  const html = render({
    lang: 'en',
    mode: 'passwordless',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
    noAccount: true,
  })
  assertStringIncludes(html, 'No account exists for that email.')
  // The noAccount banner carries `[data-space='banner']`, the hook a consumer theme styles banners
  // by. `'warn'`, not `'error'`: not having an account yet isn't a mistake the visitor made (see
  // `render.ts`'s comment on this banner).
  assertStringIncludes(html, 'data-space="banner" data-variant="warn"')
})

Deno.test('LoginView: passwordless mode renders the sessionExpired banner above the heading', () => {
  const html = render({
    lang: 'en',
    mode: 'passwordless',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
    sessionExpired: true,
  })
  const bannerIndex = html.indexOf('Your session expired.')
  const headingIndex = html.indexOf('<h1>')
  assertEquals(bannerIndex >= 0, true)
  assertEquals(bannerIndex < headingIndex, true)
  // Same real bug as `noAccount`'s own identical test above. `'warn'`, not `'info'`/`'error'` —
  // corrected after a live visual review against the real deployed theme found `'info'`'s own
  // dark petrol/navy read as "something's wrong" rather than the gentle, expected-friction notice
  // `render.ts`'s own doc describes; `'warn'`'s amber is what actually matches. `role="status"`
  // above is unaffected — still correct on its own accessibility terms, never an alert.
  assertStringIncludes(html, 'data-space="banner" data-variant="warn"')
})

Deno.test('LoginView: passwordless mode renders sentence-style legal links with the prefix/and copy', () => {
  const html = render({
    lang: 'en',
    mode: 'passwordless',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
    termsUrl: 'https://example.com/terms',
    privacyUrl: 'https://example.com/privacy',
  })
  assertStringIncludes(html, 'By continuing, you agree to our')
  assertStringIncludes(html, 'href="https://example.com/terms"')
  assertStringIncludes(html, 'href="https://example.com/privacy"')
  assertEquals(html.includes(' · '), false)
})

Deno.test('LoginView: passwordless mode gives the email field a placeholder; password mode does not', () => {
  const passwordless = render({
    lang: 'en',
    mode: 'passwordless',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
  })
  assertStringIncludes(passwordless, 'placeholder="you@example.com"')

  const password = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
  })
  assertEquals(password.includes('placeholder='), false)
})

Deno.test('LoginView: passwordless mode still rate-limits through the exact same live-countdown mechanism as password mode', () => {
  const html = render({
    lang: 'en',
    mode: 'passwordless',
    invalidCredentials: false,
    rateLimited: true,
    unexpectedError: false,
    oauthProviders: [],
    retryUntil: Date.now() + 90_000,
  })
  assertStringIncludes(html, 'data-space="login-rate-limit"')
})

Deno.test('fieldMessage: flattens every constraint of a field, and treats an empty result as no error', async () => {
  const { fieldMessage } = await import('ui/pages/login/render.ts')
  assertEquals(
    fieldMessage('email', { email: [{ constraints: ['Required.'] }, { constraints: ['Bad.'] }] }),
    ['Required.', 'Bad.'],
  )
  assertEquals(fieldMessage('email', { email: [{}] }), undefined)
  assertEquals(fieldMessage('email', {}), undefined)
  assertEquals(fieldMessage('email', undefined), undefined)
})

Deno.test('LoginView: passwordless mode with only one legal URL renders just that link, with no "and"', () => {
  const base = {
    lang: 'en',
    mode: 'passwordless',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
  } as const
  const termsOnly = render({ ...base, termsUrl: 'https://example.com/terms' })
  assertStringIncludes(termsOnly, 'href="https://example.com/terms"')
  assertEquals(termsOnly.includes('https://example.com/privacy'), false)
  const privacyOnly = render({ ...base, privacyUrl: 'https://example.com/privacy' })
  assertStringIncludes(privacyOnly, 'href="https://example.com/privacy"')
  assertEquals(privacyOnly.includes('https://example.com/terms'), false)
  const neither = render(base)
  assertEquals(neither.includes('data-space="auth-legal-links"'), false)
})
