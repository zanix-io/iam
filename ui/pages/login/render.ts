import type { Formatter } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import type { LoginViewProps } from './types.ts'

import { resolveBehavior } from '@zanix/app/runtime'

/** `Field` ids for the two real inputs — plain identity/label wiring only. */
const EMAIL_FIELD_ID = 'login-email'
const PASSWORD_FIELD_ID = 'login-password'

/** This page's own `<form>` id — `ManagedForm`'s own `formId` target. */
const FORM_ID = 'login-form'

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
 * `/comet/preact` for `ManagedForm`; this page's own `password-toggle-field/`/
 * `rate-limit-countdown/` own `index.ts` vs `/index.preact.ts`). `Button`/`Field`/`Input`/
 * `PasswordToggleField`/`RateLimitCountdown`/`ManagedForm` are all passed through `h` as component
 * REFERENCES below (`h(Field, props, ...)`), never called directly — every one of them calls a
 * real hook internally (`Field`'s `useId`, `Input`'s `useState`, `ManagedForm`'s `useEffect`); see
 * {@linkcode CreateElement}'s own doc for why that distinction is load-bearing, not stylistic.
 * `useIntl` is the one genuine exception — a real hook itself, called directly in this view's own
 * body below, exactly like a bare `useIntl()` call in any hand-written component.
 *
 * `PasswordToggleField`, `RateLimitCountdown`, and `ManagedForm` are all real Comets (hydration
 * boundaries), unlike every other entry here — see each one's own `render.ts` doc for why it
 * specifically needed one of its own.
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
  RateLimitCountdown: (
    props: {
      target: number
      size: number
      strokeWidth: number
      nonce?: string
      formId: string
      cardDataSpace: string
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
 * The real implementation of `iam`'s password-login view, shared identically between the React
 * and Preact bindings (`index.ts`/`index.preact.ts`) — parametrized by `h` plus
 * {@linkcode LoginViewDeps}. This file never imports React, Preact, or `@zanix/space-ui` itself.
 *
 * Structural (not just value-level) customization of the heading, without forking this view — two
 * routes, depending on which tier is rendering it (`docs/consuming-iam.md`): a Tier-1 host that
 * composes `iam`'s own backend via `activateApps()` overrides `iam`'s own `space.app.ts`,
 * `behaviors.loginHeading`; a Tier-2 host that only imports this view directly (no `activateApps()`
 * of its own to register a behavior override through — `resolveBehavior` resolves against a
 * registry `@zanix/app/runtime` owns process-wide, which nothing populates without it) instead
 * passes {@link LoginViewProps.heading} as a plain prop. `props.heading` wins when both are
 * present; the `?? 'Sign in'` fallback matters standalone (neither one is set at all) — same
 * defensive-fallback pattern `@zanix/app`'s own behavior-override docs recommend.
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
 * graceful-degradation shape `oauthProviders` already establishes elsewhere in this view.
 */
export function createLoginView<E>(
  h: CreateElement<E>,
  deps: LoginViewDeps<E>,
): (props: LoginViewProps) => E {
  const { useIntl, Button, Field, Input, PasswordToggleField, RateLimitCountdown, ManagedForm } =
    deps

  return function LoginView(
    {
      lang,
      csrfToken,
      fieldErrors,
      submitted,
      invalidCredentials,
      rateLimited,
      unexpectedError,
      retryUntil,
      oauthProviders,
      termsUrl,
      privacyUrl,
      heading: headingProp,
      nonce,
    }: LoginViewProps,
  ): E {
    const heading = headingProp ?? resolveBehavior<() => string>('iam', 'loginHeading')?.() ??
      'Sign in'
    const { formatMessage } = useIntl()

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
      h('h1', null, heading),
      invalidCredentials
        ? h('p', { role: 'alert' }, formatMessage('login/invalid-credentials'))
        : null,
      unexpectedError ? h('p', { role: 'alert' }, formatMessage('login/unexpected-error')) : null,
      rateLimited && !showRateLimitCountdown
        ? h('p', { role: 'alert' }, formatMessage('login/rate-limited'))
        : null,
      showRateLimitCountdown
        ? h(
          'div',
          { 'data-space': RATE_LIMIT_CARD_DATA_SPACE, role: 'status' },
          h(RateLimitCountdown, {
            target: liveRetryUntil as number,
            size: RATE_LIMIT_RING_SIZE,
            strokeWidth: RATE_LIMIT_RING_STROKE,
            nonce,
            formId: FORM_ID,
            cardDataSpace: RATE_LIMIT_CARD_DATA_SPACE,
          }),
          h(
            'p',
            { 'data-space': 'login-rate-limit-heading' },
            formatMessage('login/rate-limited/heading'),
          ),
          h(
            'p',
            { 'data-space': 'login-rate-limit-body' },
            formatMessage('login/rate-limited/body'),
          ),
        )
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
                defaultValue: submitted?.email ?? '',
                required: true,
                disabled: formDisabled,
              }),
          },
        ),
        h(
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
      termsUrl || privacyUrl
        ? h(
          'p',
          { 'data-space': 'auth-legal-links' },
          termsUrl ? h('a', { href: termsUrl }, formatMessage('login/terms-link')) : null,
          termsUrl && privacyUrl ? ' · ' : null,
          privacyUrl ? h('a', { href: privacyUrl }, formatMessage('login/privacy-link')) : null,
        )
        : null,
      oauthProviders.length > 0
        ? h(
          'ul',
          null,
          ...oauthProviders.map((provider) =>
            h(
              'li',
              { key: provider },
              h(
                'a',
                { href: `/${lang}/login/${provider}` },
                formatMessage('login/oauth-continue', { provider }),
              ),
            )
          ),
        )
        : null,
    )
  }
}
