import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { h } from 'preact'
import type { VNode } from 'preact'
import { render as renderToString } from 'preact-render-to-string'
import {
  Button,
  Countdown,
  Field,
  Input,
  IntlProvider,
  PasswordInput,
  useIntl,
} from '@zanix/space-ui/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createLoginView } from 'ui/pages/login/render.ts'
import type { LoginViewDeps } from 'ui/pages/login/render.ts'
import type { LoginViewProps } from 'ui/pages/login/types.ts'
import { createPasswordToggleField } from 'ui/components/password-toggle-field/render.ts'
import { createRateLimitCountdown } from 'ui/components/rate-limit-countdown/render.ts'
import { createRateLimitCard } from 'ui/components/rate-limit-card/render.ts'

// Same behavior as `login.test.ts` (the React binding), verified independently against the Preact
// one — this pair is what actually proves `createLoginView`'s shared logic (`render.ts`) behaves
// identically regardless of which renderer it's bound to. Built directly from `render.ts` with a
// `null`-rendering `ManagedForm` stand-in and `PasswordToggleField`/`RateLimitCard` each built
// from their own raw, un-wrapped factory (same reasoning `login.test.ts` documents in full), never
// the real `@zanix/space/comet/preact` Comet boundary: this file deliberately never registers the
// Preact renderer with `@zanix/space` at all (see `login.test.ts`'s own doc on `ManagedForm` — the
// React/Preact registration is process-wide and mutually exclusive, and `login.test.ts`'s own
// dedicated wiring tests already cover the real Comets end to end for one renderer, matching
// `@zanix/space-ui`'s own `NavDrawer` precedent of not paying that cost twice).

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

const LoginViewForContent = createLoginView<VNode>(
  h as unknown as CreateElement<VNode>,
  {
    useIntl,
    Button,
    Field,
    Input,
    PasswordToggleField: createPasswordToggleField<VNode>(
      h as unknown as CreateElement<VNode>,
      { PasswordInput: PasswordInput as unknown as (props: Record<string, unknown>) => VNode },
    ) as unknown as LoginViewDeps<VNode>['PasswordToggleField'],
    RateLimitCard: createRateLimitCard<VNode>(
      h as unknown as CreateElement<VNode>,
      {
        RateLimitCountdown: createRateLimitCountdown<VNode>(
          h as unknown as CreateElement<VNode>,
          { Countdown: Countdown as unknown as (props: Record<string, unknown>) => VNode },
        ) as unknown as (props: Record<string, unknown>) => VNode,
      },
    ) as unknown as LoginViewDeps<VNode>['RateLimitCard'],
    ManagedForm: () => null,
  },
)

function render(props: LoginViewProps): string {
  return renderToString(
    h(IntlProvider, { locale: 'en', messages: TEST_MESSAGES }, h(LoginViewForContent, props)),
  )
}

Deno.test('LoginView (preact): renders the default "Sign in" heading', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
  })
  assertStringIncludes(html, '<h1>Sign in</h1>')
})

Deno.test('LoginView (preact): the heading prop overrides the default', () => {
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

Deno.test('LoginView (preact): renders every message-catalog string for real, through IntlProvider', () => {
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
})

Deno.test('LoginView (preact): renders a Terms and Conditions link once termsUrl is set', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
    termsUrl: 'https://example.com/terms',
  })
  assertStringIncludes(html, 'href="https://example.com/terms"')
})

Deno.test('LoginView (preact): renders no Terms and Conditions link when termsUrl is unset', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
  })
  assertEquals(html.includes('Terms and Conditions'), false)
})

Deno.test('LoginView (preact): renders a Privacy Notice link once privacyUrl is set', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
    privacyUrl: 'https://example.com/privacy',
  })
  assertStringIncludes(html, 'href="https://example.com/privacy"')
})

Deno.test('LoginView (preact): renders no Privacy Notice link when privacyUrl is unset', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
  })
  assertEquals(html.includes('Privacy Notice'), false)
})

Deno.test('LoginView (preact): renders both links, separated, when termsUrl and privacyUrl are both set', () => {
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

Deno.test('LoginView (preact): renders the flattened field errors when present', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
    fieldErrors: { email: [{ constraints: ['Must be a valid email.'] }] },
  })
  assertStringIncludes(html, 'Must be a valid email.')
})

// --- Rate-limit countdown --------------------------------------------------------------------

Deno.test('LoginView (preact): rateLimited with no retryUntil falls back to the static message', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: true,
    unexpectedError: false,
    oauthProviders: [],
  })
  assertStringIncludes(html, 'Too many attempts')
  assertEquals(html.includes('data-space="login-rate-limit"'), false)
})

Deno.test('LoginView (preact): rateLimited with a future retryUntil renders the live countdown card', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: true,
    unexpectedError: false,
    oauthProviders: [],
    retryUntil: Date.now() + 90_000,
  })
  assertStringIncludes(html, 'data-space="login-rate-limit"')
  assertStringIncludes(html, "For your security, we've paused sign-in attempts")
  assertEquals(html.includes('Too many attempts'), false)
})

Deno.test('LoginView (preact): nonce reaches both the rate-limit Countdown and the password field', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: true,
    unexpectedError: false,
    oauthProviders: [],
    retryUntil: Date.now() + 90_000,
    nonce: 'abc123',
  })
  const nonceStyleCount = html.split('<style nonce="abc123">').length - 1
  assertEquals(nonceStyleCount >= 2, true)
})

Deno.test('LoginView (preact): rateLimited with a PAST retryUntil behaves like no retryUntil at all', () => {
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
})

// --- Password visibility toggle ----------------------------------------------------------------

Deno.test('LoginView (preact): the password field renders a real show/hide toggle', () => {
  const html = render({
    lang: 'en',
    invalidCredentials: false,
    rateLimited: false,
    unexpectedError: false,
    oauthProviders: [],
  })
  assertStringIncludes(html, 'Show password')
})

// --- Real wiring — the actual `index.preact.ts` binding, constructed but never rendered ---------

Deno.test('LoginView (index.preact.ts): the real binding constructs without throwing', async () => {
  // Actually RENDERING the real Comet needs the active renderer flipped to `'preact'` — a
  // process-wide side effect this test suite deliberately never triggers (see this file's own
  // header doc). Constructing the binding itself (module evaluation, `createLoginView` call) needs
  // no such registration, since `ManagedForm`'s own `defineComet` wrapping only resolves an element
  // factory once actually called — this still proves `index.preact.ts` itself evaluates cleanly.
  const mod = await import('ui/pages/login/index.preact.ts')
  assertEquals(typeof mod.LoginView, 'function')
})
