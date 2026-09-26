import type { Formatter } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import type { LoginViewProps } from './types.ts'
import { providerIcon, providerLabel } from '../provider-display.ts'

import { resolveBehavior } from '@zanix/app/runtime'

/** `Field` ids for the two real inputs — plain identity/label wiring only. */
const EMAIL_FIELD_ID = 'login-email'
const PASSWORD_FIELD_ID = 'login-password'

/** This page's own `<form>` id — `ManagedForm`'s own `formId` target. */
const FORM_ID = 'login-form'

/** {@link LoginViewProps.mode}'s own default — every existing `'password'`-mode caller omits
 * `mode` entirely, so this is what makes that stay true after adding `'passwordless'`. */
const DEFAULT_MODE = 'password' as const

/**
 * `FormDraftPersistence`'s own `storageKey` for this form — a plain, `[lang]`-independent literal
 * (this project's `[lang]`-segment routing renders this SAME logical form at a different pathname
 * per language, which a pathname-derived key would fragment an operator's own in-progress draft
 * across). Recovers a typed `email` after an accidental refresh or navigate-away-and-back;
 * `password` is excluded automatically (every `type="password"` field always is).
 */
const DRAFT_STORAGE_KEY = 'login'

/** `Countdown`'s own `variant="ring"` size/stroke for the rate-limit card — a fixed, deliberately
 * modest choice (this card is a transient notice, not a hero element), rather than exposing it as
 * a `LoginView` prop nothing currently needs to vary. */
const RATE_LIMIT_RING_SIZE = 72
const RATE_LIMIT_RING_STROKE = 5

/** The rate-limit card's own root `data-space` — `RateLimitCountdown`'s own `cardDataSpace` prop
 * target (the element it removes, via the DOM, once the countdown reaches zero — see that
 * Comet's own `render.ts` doc). Named here, not inlined twice, so the value passed to the Comet
 * and the value on the actual rendered `<div>` below can never drift apart. */
const RATE_LIMIT_CARD_DATA_SPACE = 'login-rate-limit'

/**
 * The `@zanix/space-ui` bindings, hook, and Comets this view needs, injected alongside `h` —
 * `index.ts`/`index.preact.ts` each supply their own renderer's real, already-bound copies
 * (`@zanix/space-ui`'s root barrel for React, `/preact` for Preact; `@zanix/space/comet/react` vs
 * `/comet/preact` for `ManagedForm`; `ui/components/password-toggle-field/`'s own `index.ts` vs
 * `/index.preact.ts` — a shared component, not private to this page, since any password field
 * anywhere needs the same working show/hide toggle; `ui/
 * components/rate-limit-card/`'s own `index.ts` vs `/index.preact.ts` — likewise shared, not
 * private, since a host app's own differently-worded rate-limited form needs the identical card).
 * `Button`/`Field`/`Input`/`PasswordToggleField`/`RateLimitCard`/`ManagedForm` are all passed
 * through `h` as component REFERENCES below (`h(Field, props, ...)`), never called directly —
 * every one of them calls a real hook internally (`Field`'s `useId`, `Input`'s `useState`,
 * `ManagedForm`'s `useEffect`); see {@linkcode CreateElement}'s own doc for why that distinction
 * is load-bearing, not stylistic. `useIntl` is the one genuine exception — a real hook itself,
 * called directly in this view's own body below, exactly like a bare `useIntl()` call in any
 * hand-written component.
 *
 * `PasswordToggleField`, `ManagedForm`, and (composed inside `RateLimitCard`) `RateLimitCountdown`
 * are all real Comets (hydration boundaries) — `RateLimitCard` itself is NOT one, a plain
 * presentational wrapper; see each one's own `render.ts` doc for why it specifically needed a
 * boundary of its own.
 */
export type LoginViewDeps<E> = {
  useIntl: () => Formatter
  Button: (
    props: { type?: 'button' | 'submit' | 'reset'; disabled?: boolean; className?: string },
  ) => E
  Field: (
    props: {
      id: string
      label: string
      error?: string | string[]
      children: (fieldProps: Record<string, unknown>) => E
    },
  ) => E
  Input: (props: Record<string, unknown>) => E
  PasswordToggleField: (
    props: Record<string, unknown> & { showLabel: string; hideLabel: string },
  ) => E
  RateLimitCard: (
    props: {
      target: number
      size: number
      strokeWidth: number
      nonce?: string
      formId: string
      cardDataSpace: string
      clearQueryParamsOnComplete?: string[]
      headingLabel: string
      bodyLabel: string
    },
  ) => E
  ManagedForm: (
    props: {
      formId: string
      draft?: { storageKey: string; hasServerValues: boolean }
      submitGuard?: boolean
    },
  ) => E | null
}

/** Extracts a single field's already-resolved error message(s) out of `PageFieldErrors`.
 * `undefined` (not `[]`) when the field has no error, so `Field`'s own "was an error given at all"
 * branch stays accurate. */
export function fieldMessage(
  property: string,
  fieldErrors: LoginViewProps['fieldErrors'],
): string[] | undefined {
  const entries = fieldErrors?.[property] as { constraints?: string[] }[] | undefined
  const messages = entries?.flatMap((entry) => entry.constraints ?? [])
  return messages?.length ? messages : undefined
}

/**
 * The real implementation of `iam`'s login view, shared identically between the React and Preact
 * bindings (`index.ts`/`index.preact.ts`) — parametrized by `h` plus {@linkcode LoginViewDeps}.
 * This file never imports React, Preact, or `@zanix/space-ui` itself.
 *
 * ## `mode: 'password'` (default) vs. `mode: 'passwordless'`
 *
 * `'password'` mode's markup is untouched by this doc's own history — every branch below gated on
 * `isPasswordless` is a pure addition, never a change to what an existing `'password'`-mode caller
 * already rendered. `'passwordless'` mode renders no password field at all (the submit only ever
 * dispatches a login code), moves the OAuth2 provider(s) into a prominent button block ABOVE the
 * form instead of the plain link list `'password'` mode renders below it (`data-space=
 * 'auth-oauth-button'`/`data-provider`; the Google mark is inline in the button, any other
 * provider's is the host's to add through its `data-provider`), and
 * swaps the heading/subtext/legal-copy composition for their own dedicated message keys
 * (`login/heading`, `login/subtext`, `login/or-email`, `login/email-placeholder`,
 * `login/legal-prefix`, `login/legal-and`) rather than the `heading` prop/`resolveBehavior`
 * mechanism below — see that mechanism's own doc for why `'password'` mode still needs it and
 * `'passwordless'` mode doesn't. It gives a passwordless host a real, shared view built on real
 * `@zanix/space-ui` components instead of hand-rolled login form markup.
 *
 * ## OAuth2 provider control: a real `<form method="post">`, never `<a href>`
 *
 * Both modes' own OAuth2 provider control (the prominent button above, the plain link below) POSTs
 * straight to `/{lang}/login/{provider}`: a plain `<a href>` there can only ever reach a
 * GET-rendered confirmation screen (`SpacePageController`'s own static `redirect` can't compute
 * the provider's real authorize URL dynamically — only a real `POST` `action` can), and that
 * screen's own client-side auto-submit still needs a full page load + hydration first, a visible
 * flash. A `<form>` here skips that screen
 * entirely — works identically with or without JS, one real navigation straight to the provider.
 *
 * Structural (not just value-level) customization of the `'password'`-mode heading, without
 * forking this view — two routes, depending on which tier is rendering it
 * (`docs/consuming-iam.md`): a Tier-1 host that composes `iam`'s own backend via `activateApps()`
 * overrides `iam`'s own `space.app.ts`, `behaviors.loginHeading`; a Tier-2 host that only imports
 * this view directly (no `activateApps()` of its own to register a behavior override through —
 * `resolveBehavior` resolves against a registry `@zanix/app/runtime` owns process-wide, which
 * nothing populates without it) instead passes {@link LoginViewProps.heading} as a plain prop.
 * `props.heading` wins when both are present; the `?? 'Sign in'` fallback matters standalone
 * (neither one is set at all) — same defensive-fallback pattern `@zanix/app`'s own
 * behavior-override docs recommend.
 *
 * ## Rate-limit countdown — real state, not a static message
 *
 * `rateLimited && retryUntil` renders a live countdown card instead of the plain static message,
 * and disables every field/the submit button while it's active — visibly "waiting", never
 * "broken". The countdown itself, and re-enabling the form the instant it reaches zero with NO
 * page reload, are both owned entirely by `RateLimitCountdown`'s own Comet — this view holds no
 * state of its own for either (`showRateLimitCountdown`/`formDisabled` below are plain,
 * server-evaluated booleans, correct for THIS render; the live wall-clock completion is the
 * Comet's own concern once mounted — see that Comet's own `render.ts` doc for the full mechanism
 * and why it reaches outside its own root to do it). `rateLimited` with no `retryUntil` (a Tier-2
 * consumer not wired to thread the real `Retry-After` value through, or a `429` that genuinely
 * carried none) falls back to the original static message, disabling nothing — the same
 * graceful-degradation shape `oauthProviders` already establishes elsewhere in this view. Applies
 * identically in both modes: a `'passwordless'` host rate-limits login-code dispatch through the
 * exact same shape a `'password'` host rate-limits `POST /login/login`.
 */
export function createLoginView<E>(
  h: CreateElement<E>,
  deps: LoginViewDeps<E>,
): (props: LoginViewProps) => E {
  const { useIntl, Button, Field, Input, PasswordToggleField, RateLimitCard, ManagedForm } = deps

  return function LoginView(
    {
      lang,
      mode = DEFAULT_MODE,
      csrfToken,
      fieldErrors,
      submitted,
      invalidCredentials,
      noAccount,
      sessionExpired,
      rateLimited,
      unexpectedError,
      retryUntil,
      clearQueryParamsOnRateLimitComplete,
      oauthProviders,
      termsUrl,
      privacyUrl,
      heading: headingProp,
      nonce,
    }: LoginViewProps,
  ): E {
    const isPasswordless = mode === 'passwordless'
    const { formatMessage } = useIntl()
    const heading = isPasswordless
      ? formatMessage('login/heading')
      : headingProp ?? resolveBehavior<() => string>('iam', 'loginHeading')?.() ?? 'Sign in'

    // A stale `retryUntil` already in the past (e.g. a bookmarked/reloaded URL) never renders the
    // countdown card — there's nothing left to wait for, so this behaves exactly like `rateLimited`
    // with no `retryUntil` at all: the static fallback message, form left enabled. Evaluated once
    // per render, off already-resolved data — not a live clock read anything downstream depends on.
    const liveRetryUntil = retryUntil !== undefined && retryUntil > Date.now()
      ? retryUntil
      : undefined
    const showRateLimitCountdown = rateLimited && liveRetryUntil !== undefined
    const formDisabled = showRateLimitCountdown

    return h(
      'main',
      null,
      // `'passwordless'`-only: a genuine session expiry is normal, expected friction (see
      // `LoginViewProps.sessionExpired`'s own doc), so it
      // renders ABOVE the heading as an informational notice, never as an alert. The
      // `[data-space='banner'][data-variant]` pair is the hook the default stylesheet
      // (`ui/styles.ts`) and an app's own CSS style; every other `<p role="alert"|"status">` below
      // carries it too.
      //
      // `'warn'`, not `'info'`: a cool `info` colour reads as "something's wrong" here, while the
      // amber `warn` matches "normal, expected friction". See this file's own
      // variant-consistency note below (`noAccount`) for the fuller reasoning this settled into:
      // `'error'` (red) is reserved for a genuine mistake/failure the visitor caused or a real
      // system fault; `'warn'` (amber) for a blocking-but-not-a-mistake state that just needs
      // acknowledgment or a different next step.
      sessionExpired
        ? h(
          'p',
          { role: 'status', 'data-space': 'banner', 'data-variant': 'warn' },
          formatMessage('login/session-expired'),
        )
        : null,
      h('h1', null, heading),
      // `login/subtext` may mention the OAuth2 buttons, so it only renders when at least one
      // provider is configured — the same `oauthProviders.length > 0` gate the buttons below use;
      // otherwise `login/subtext-no-oauth` renders instead. Both are REQUIRED message keys for a
      // `'passwordless'` host (see this function's own doc for why that mode uses its own key set
      // instead of `resolveBehavior`); a missing key renders its raw id (this package's
      // `Formatter` falls back to the id, never a throw).
      isPasswordless
        ? h(
          'p',
          null,
          formatMessage(oauthProviders.length > 0 ? 'login/subtext' : 'login/subtext-no-oauth'),
        )
        : null,
      invalidCredentials
        ? h(
          'p',
          { role: 'alert', 'data-space': 'banner', 'data-variant': 'error' },
          formatMessage('login/invalid-credentials'),
        )
        : null,
      // `'warn'`, not `'error'` — same variant-consistency pass `sessionExpired`'s own comment
      // above documents: not existing yet isn't a mistake the visitor made (unlike
      // `invalidCredentials`, a real wrong-password case), so it reads as a next-step nudge
      // (amber), not a failure (red) — `role="alert"` (assertive) is unaffected, still correct on
      // its own accessibility terms regardless of which color conveys it visually.
      noAccount
        ? h(
          'p',
          { role: 'alert', 'data-space': 'banner', 'data-variant': 'warn' },
          formatMessage('login/no-account'),
        )
        : null,
      unexpectedError
        ? h(
          'p',
          { role: 'alert', 'data-space': 'banner', 'data-variant': 'error' },
          formatMessage('login/unexpected-error'),
        )
        : null,
      // `'warn'`, not `'error'` — unlike the three above, this isn't something the visitor got
      // wrong; it's a temporary "please wait" state (the same reasoning `showRateLimitCountdown`'s
      // own dedicated card, rendered instead whenever a real `retryUntil` is available, already
      // carries — this is only its static fallback for when one isn't).
      rateLimited && !showRateLimitCountdown
        ? h(
          'p',
          { role: 'alert', 'data-space': 'banner', 'data-variant': 'warn' },
          formatMessage('login/rate-limited'),
        )
        : null,
      // `RateLimitCard` (`ui/components/rate-limit-card/`) — the one shared implementation of the
      // heading/body/countdown shape, composed here and by any consumer's own rate-limited form
      // (see that component's own doc).
      showRateLimitCountdown
        ? h(RateLimitCard, {
          target: liveRetryUntil as number,
          size: RATE_LIMIT_RING_SIZE,
          strokeWidth: RATE_LIMIT_RING_STROKE,
          nonce,
          formId: FORM_ID,
          cardDataSpace: RATE_LIMIT_CARD_DATA_SPACE,
          clearQueryParamsOnComplete: clearQueryParamsOnRateLimitComplete,
          headingLabel: formatMessage('login/rate-limited/heading'),
          bodyLabel: formatMessage('login/rate-limited/body'),
        })
        : null,
      // `'passwordless'`-only: the OAuth2 provider(s) as prominent buttons ABOVE the form — see
      // this function's own doc for why this differs from `'password'` mode's bottom link list.
      isPasswordless && oauthProviders.length > 0
        ? h(
          'div',
          { 'data-space': 'auth-oauth-buttons' },
          ...oauthProviders.map((provider) =>
            h(
              'form',
              { key: provider, method: 'post', action: `/${lang}/login/${provider}` },
              h('input', { type: 'hidden', name: '_csrf', value: csrfToken ?? '' }),
              h(
                'button',
                {
                  type: 'submit',
                  'data-space': 'auth-oauth-button',
                  'data-provider': provider,
                },
                providerIcon(h, provider),
                formatMessage('login/oauth-continue', { provider: providerLabel(provider) }),
              ),
            )
          ),
        )
        : null,
      isPasswordless && oauthProviders.length > 0
        ? h('div', { 'data-space': 'auth-divider' }, formatMessage('login/or-email'))
        : null,
      h(ManagedForm, {
        formId: FORM_ID,
        draft: { storageKey: DRAFT_STORAGE_KEY, hasServerValues: submitted !== undefined },
        submitGuard: true,
      }),
      h(
        'form',
        { method: 'post', id: FORM_ID },
        h('input', { type: 'hidden', name: '_csrf', value: csrfToken ?? '' }),
        h(
          Field,
          {
            id: EMAIL_FIELD_ID,
            label: formatMessage('login/email-label'),
            error: fieldMessage('email', fieldErrors),
            children: (fieldProps: Record<string, unknown>) =>
              h(Input, {
                ...fieldProps,
                name: 'email',
                type: 'email',
                autoComplete: 'username',
                placeholder: isPasswordless ? formatMessage('login/email-placeholder') : undefined,
                defaultValue: submitted?.email ?? '',
                required: true,
                disabled: formDisabled,
              }),
          },
        ),
        isPasswordless ? null : h(
          Field,
          {
            id: PASSWORD_FIELD_ID,
            label: formatMessage('login/password-label'),
            error: fieldMessage('password', fieldErrors),
            children: (fieldProps: Record<string, unknown>) =>
              h(PasswordToggleField, {
                ...fieldProps,
                name: 'password',
                autoComplete: 'current-password',
                required: true,
                disabled: formDisabled,
                showLabel: formatMessage('login/password-show'),
                hideLabel: formatMessage('login/password-hide'),
                nonce,
              }),
          },
        ),
        h(
          Button,
          { type: 'submit', disabled: formDisabled, className: 'btn btn-primary btn-block' },
          formatMessage('login/submit'),
        ),
      ),
      isPasswordless
        ? (termsUrl || privacyUrl
          ? h(
            'p',
            { 'data-space': 'auth-legal-links' },
            formatMessage('login/legal-prefix'),
            ' ',
            termsUrl ? h('a', { href: termsUrl }, formatMessage('login/terms-link')) : null,
            termsUrl && privacyUrl ? ` ${formatMessage('login/legal-and')} ` : null,
            privacyUrl ? h('a', { href: privacyUrl }, formatMessage('login/privacy-link')) : null,
            '.',
          )
          : null)
        : (termsUrl || privacyUrl
          ? h(
            'p',
            { 'data-space': 'auth-legal-links' },
            termsUrl ? h('a', { href: termsUrl }, formatMessage('login/terms-link')) : null,
            termsUrl && privacyUrl ? ' · ' : null,
            privacyUrl ? h('a', { href: privacyUrl }, formatMessage('login/privacy-link')) : null,
          )
          : null),
      // `'password'`-only: `'passwordless'` mode already rendered its provider(s) above, as
      // buttons — never duplicated down here too.
      !isPasswordless && oauthProviders.length > 0
        ? h(
          'ul',
          null,
          ...oauthProviders.map((provider) =>
            h(
              'li',
              { key: provider },
              h(
                'form',
                { method: 'post', action: `/${lang}/login/${provider}` },
                h('input', { type: 'hidden', name: '_csrf', value: csrfToken ?? '' }),
                h(
                  'button',
                  { type: 'submit', 'data-space': 'auth-oauth-link' },
                  formatMessage('login/oauth-continue', { provider: providerLabel(provider) }),
                ),
              ),
            )
          ),
        )
        : null,
    )
  }
}
