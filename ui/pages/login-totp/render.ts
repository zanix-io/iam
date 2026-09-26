import type { Formatter } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import type { AuthHiddenFieldsProps } from 'ui/components/auth-hidden-fields/types.ts'
import type { TotpViewProps } from './types.ts'

const CODE_FIELD_ID = 'totp-code'

/** This page's own `<form>` id — `SubmitGuard`'s own `formId` target, and `RateLimitCard`'s own
 * `formId` target (re-enables this same form's fields once the countdown reaches zero). */
const FORM_ID = 'login-totp-form'

/** `Countdown`'s own `variant="ring"` size/stroke for the rate-limit card — the exact same values
 * `login/render.ts` uses for its own card, so every rate-limit card in this project looks
 * identical wherever it renders. */
const RATE_LIMIT_RING_SIZE = 72
const RATE_LIMIT_RING_STROKE = 5

/** The rate-limit card's own root `data-space` — distinct from `login/render.ts`'s own
 * `'login-rate-limit'` so the two, if either is somehow mounted alongside the other, never
 * collide on the same DOM selector. */
const RATE_LIMIT_CARD_DATA_SPACE = 'login-totp-rate-limit'

/** The `@zanix/space-ui` bindings, hook, and Comet this view needs, injected alongside `h` — see
 * `login/render.ts`'s own doc for why these are all passed through `h` as component REFERENCES,
 * never called directly, and why `RateLimitCard` itself isn't a Comet (a plain presentational
 * wrapper; the Comet boundary lives inside it, on the `RateLimitCountdown` it composes). */
export type TotpViewDeps<E> = {
  useIntl: () => Formatter
  Button: (props: { type?: 'button' | 'submit' | 'reset'; disabled?: boolean }) => E
  Field: (
    props: {
      id: string
      label: string
      error?: string | string[]
      children: (fieldProps: Record<string, unknown>) => E
    },
  ) => E
  Input: (props: Record<string, unknown>) => E
  SubmitGuard: (props: { formId: string }) => E | null
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
  /** `ui/components/auth-hidden-fields`'s own bound `authHiddenFields` — a plain function, never a
   * component reference (see that component's own doc for why it returns `E[]`, not `E`, and is
   * spread into `<form>`'s children rather than passed through `h`). */
  authHiddenFields: (props: AuthHiddenFieldsProps) => E[]
}

/** Extracts a single field's already-resolved error message(s) out of `PageFieldErrors` — same
 * shape/reasoning as `login/render.ts`'s own `fieldMessage`. */
function fieldMessage(
  property: string,
  fieldErrors: TotpViewProps['fieldErrors'],
): string[] | undefined {
  const entries = fieldErrors?.[property] as { constraints?: string[] }[] | undefined
  const messages = entries?.flatMap((entry) => entry.constraints ?? [])
  return messages?.length ? messages : undefined
}

/**
 * The real implementation of `iam`'s TOTP (authenticator-app) second-factor LOGIN challenge view
 * — distinct from `totp-confirm`/`totp-enroll` (this project's TOTP ENROLLMENT views) — shared
 * identically between the React and Preact bindings (`index.ts`/`index.preact.ts`). This file
 * never imports React, Preact, or `@zanix/space-ui` itself.
 *
 * No draft persistence (`SubmitGuard`, not `ManagedForm`) — same single-use-code reasoning as
 * `login-otp/render.ts`.
 *
 * ## Rate-limit countdown
 *
 * A `429` from `POST /login/totp/callback` belongs on THIS screen as a "wait a moment" message —
 * left unhandled, it escapes to a host app's own generic `onError` chain and lands the visitor on
 * an unrelated page. `rateLimited`/`retryUntil`/`RateLimitCard` mirror `LoginView`'s own identical
 * mechanism (`login/render.ts`), so a consuming page's own `action` redirects back here with the
 * SAME shape `login/page.tsx` uses for its own `429`.
 */
export function createTotpLoginView<E>(
  h: CreateElement<E>,
  deps: TotpViewDeps<E>,
): (props: TotpViewProps) => E {
  const { useIntl, Button, Field, Input, SubmitGuard, RateLimitCard, authHiddenFields } = deps

  return function TotpLoginView(
    {
      lang,
      email,
      csrfToken,
      fieldErrors,
      invalidCode,
      rateLimited,
      unexpectedError,
      retryUntil,
      clearQueryParamsOnRateLimitComplete,
      nonce,
    }: TotpViewProps,
  ): E {
    const { formatMessage } = useIntl()

    // Same "a stale retryUntil already in the past never renders the countdown" guard
    // `login/render.ts` applies to its own card — see that file's own doc.
    const liveRetryUntil = retryUntil !== undefined && retryUntil > Date.now()
      ? retryUntil
      : undefined
    const showRateLimitCountdown = rateLimited && liveRetryUntil !== undefined
    const formDisabled = showRateLimitCountdown

    return h(
      'main',
      null,
      h('h1', null, formatMessage('login/totp/heading')),
      h('p', null, formatMessage('login/totp/signing-in-as', { email })),
      // The `data-space='banner'`/`data-variant` pair is the hook the default stylesheet
      // (`ui/styles.ts`) and an app's own CSS style; see `login/render.ts`.
      invalidCode
        ? h(
          'p',
          { role: 'alert', 'data-space': 'banner', 'data-variant': 'error' },
          formatMessage('login/totp/invalid-code'),
        )
        : null,
      rateLimited && !showRateLimitCountdown
        ? h(
          'p',
          { role: 'alert', 'data-space': 'banner', 'data-variant': 'warn' },
          formatMessage('login/totp/rate-limited'),
        )
        : null,
      showRateLimitCountdown
        ? h(RateLimitCard, {
          target: liveRetryUntil as number,
          size: RATE_LIMIT_RING_SIZE,
          strokeWidth: RATE_LIMIT_RING_STROKE,
          nonce,
          formId: FORM_ID,
          cardDataSpace: RATE_LIMIT_CARD_DATA_SPACE,
          clearQueryParamsOnComplete: clearQueryParamsOnRateLimitComplete,
          headingLabel: formatMessage('login/totp/rate-limited/heading'),
          bodyLabel: formatMessage('login/totp/rate-limited/body'),
        })
        : null,
      unexpectedError
        ? h(
          'p',
          { role: 'alert', 'data-space': 'banner', 'data-variant': 'error' },
          formatMessage('login/totp/unexpected-error'),
        )
        : null,
      h(SubmitGuard, { formId: FORM_ID }),
      h(
        'form',
        { method: 'post', id: FORM_ID },
        ...authHiddenFields({ csrfToken, email }),
        h(
          Field,
          {
            id: CODE_FIELD_ID,
            label: formatMessage('login/totp/code-label'),
            error: fieldMessage('code', fieldErrors),
            children: (fieldProps: Record<string, unknown>) =>
              h(Input, {
                ...fieldProps,
                name: 'code',
                type: 'text',
                required: true,
                disabled: formDisabled,
              }),
          },
        ),
        h(Button, { type: 'submit', disabled: formDisabled }, formatMessage('common/verify')),
      ),
      h(
        'p',
        { 'data-space': 'auth-back-link' },
        h('a', { href: `/${lang}/login` }, formatMessage('common/back-to-sign-in')),
      ),
    )
  }
}
