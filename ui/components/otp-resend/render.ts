import type { CreateElement } from 'ui/typings/renderer.ts'
import type { OtpResendProps } from './types.ts'

/** The renderer's own already-built `Button`/`Countdown` (`@zanix/space-ui` for React,
 * `@zanix/space-ui/preact` for Preact) this Comet wraps unmodified, injected the same way
 * `login/render.ts`'s own `LoginViewDeps` injects every `@zanix/space-ui` component it uses —
 * `index.ts`/`index.preact.ts` each supply their own renderer's real copy. */
export type OtpResendDeps<E> = {
  Button: (props: Record<string, unknown>) => E
  Countdown: (props: Record<string, unknown>) => E
}

/** This Comet's own root `id`s — targeted directly via `document.getElementById` from
 * `Countdown`'s `onComplete`, the same real-DOM-surgery idiom `RateLimitCountdown`'s own doc
 * documents in full (a Comet mounts as its own, separate hydration root, with no inherited
 * context or shared state across that boundary, so there is no live framework state an
 * `onComplete` callback anywhere else could flip instead). */
const COOLDOWN_ID = 'otp-resend-cooldown'
const PRIMARY_FORM_ID = 'otp-resend-primary'
const SUBMIT_BUTTON_ID = 'otp-resend-submit'
const NOTIFIER_SELECT_ID = 'otp-resend-notifier'

/**
 * The real, renderer-neutral implementation `index.ts`/`index.preact.ts` each wrap in
 * `defineComet` — composes the unmodified `Button`/`Countdown` (`@zanix/space-ui`), the same
 * "composed, not reimplemented" rule `password-toggle-field/render.ts`'s own doc already
 * establishes; this file adds no ticking/formatting logic of its own, only the resend/channel-
 * picker markup plus the one real addition below.
 *
 * A shared component (`ui/components/`), not private to any one page — an app's own
 * differently-styled OTP screen can compose it instead of `iam`'s generic `OtpView`
 * (`ui/pages/login-otp/render.ts`), which composes it too — every real OTP-login screen needs the
 * identical capability, so it lives
 * promoted rather than duplicated per caller.
 *
 * ## Why this needed its own Comet
 *
 * Same root cause `RateLimitCountdown`'s own doc documents: `Countdown`'s live wall-clock tick
 * relies on a real mount `useEffect`, so the cooldown countdown needs a hydration boundary of its
 * own to ever tick at all. `Countdown`'s own `onComplete` swaps the countdown span for the submit
 * button via direct DOM (`hidden` attribute) — the same "real DOM work inside a hydrated Comet's
 * own effect" idiom `RateLimitCountdown`'s own doc establishes for its own `onComplete` — never
 * Preact/React state.
 *
 * This component's own root is always exactly ONE `<form>` element — no `Fragment` needed, unlike
 * `RateLimitCountdown`'s own sibling components that sometimes return more than one root node:
 * every real state this component can be in (no cooldown info, an active cooldown, a completed
 * one, a picker present or not) is expressed as children WITHIN that one form, never as a second
 * sibling root — see the next section for why that's load-bearing, not incidental.
 *
 * ## One form, always visible — only the trailing action swaps during a cooldown
 *
 * One `<form>`, one button, the channel picker beside it (see
 * {@linkcode OtpResendProps.notifierOptions}'s own doc). A cooldown is the normal outcome of
 * clicking resend, so it must never hide the picker feeding that same action.
 *
 * This component never hides the `<form>` or the picker at all — `cooldownActive` only toggles
 * which ONE of two SIBLING elements is visible at the form's own end: the plain submit button, or
 * the live countdown span in its place. A caller can freely change their selected channel at any
 * time, including WHILE a cooldown from their own last resend is still counting down, ready the
 * instant it completes — no picker ever disappears out from under them.
 */
export function createOtpResend<E>(
  h: CreateElement<E>,
  { Button, Countdown }: OtpResendDeps<E>,
): (props: OtpResendProps) => E {
  return function OtpResend(
    {
      lang,
      email,
      csrfToken,
      cooldownEndsAt,
      resendLabel,
      cooldownLabel,
      nonce,
      notifierOptions,
      currentNotifier,
      notifierPickerLabel,
    }: OtpResendProps,
  ): E {
    const cooldownActive = typeof cooldownEndsAt === 'number' && cooldownEndsAt > Date.now()
    const actionUrl = `/${lang}/login/otp/${encodeURIComponent(email)}/resend`
    const hasChoice = (notifierOptions?.length ?? 0) > 1

    // Always rendered, never hidden by a cooldown — see this file's own doc. `hasChoice` alone
    // decides whether it exists at all.
    const picker = hasChoice
      ? h(
        'span',
        { 'data-space': 'otp-resend-notifier-picker' },
        h('label', { htmlFor: NOTIFIER_SELECT_ID }, notifierPickerLabel),
        h(
          // `defaultValue` (never `selected` on each `<option>`) — React's own SSR/hydration
          // model treats a controlled `<select>`'s selection as the PARENT's own prop, and warns
          // ("use defaultValue/value instead of selected") when an option sets it directly
          // instead; Preact's `h` accepts the identical `defaultValue` shape, so this is the one
          // form that renders correctly, warning-free, on both renderers.
          'select',
          { name: 'notifier', id: NOTIFIER_SELECT_ID, defaultValue: currentNotifier },
          ...(notifierOptions ?? []).map((option) =>
            h('option', { value: option.value, key: option.value }, option.label)
          ),
        ),
      )
      : null

    // The form's own trailing action — the plain submit button when no cooldown is active (or no
    // cooldown info exists at all), the live countdown in its EXACT place once one is. Both are
    // real children of the SAME always-visible form; only one of the two ever lacks `hidden`. A
    // plain `<span>` wrapper carries `hidden` — `Button`'s own prop allowlist
    // (`@zanix/space-ui`'s own `render.ts`) has no `hidden` field of its own to forward it to.
    const submitButton = h(
      'span',
      { id: SUBMIT_BUTTON_ID, hidden: cooldownActive || undefined },
      h(Button, { type: 'submit', className: 'btn-text' }, resendLabel),
    )
    const cooldownSpan = cooldownEndsAt
      ? h(
        'span',
        { 'data-space': 'auth-hint', id: COOLDOWN_ID, hidden: !cooldownActive || undefined },
        cooldownLabel,
        ' ',
        h(Countdown, {
          target: cooldownEndsAt,
          nonce,
          onComplete: () => {
            document.getElementById(COOLDOWN_ID)?.setAttribute('hidden', '')
            document.getElementById(SUBMIT_BUTTON_ID)?.removeAttribute('hidden')
          },
        }),
      )
      : null

    return h(
      'form',
      { method: 'post', action: actionUrl, id: PRIMARY_FORM_ID },
      h('input', { type: 'hidden', name: '_csrf', value: csrfToken }),
      picker,
      cooldownSpan,
      submitButton,
    )
  }
}
