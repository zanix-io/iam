import type { NOTIFIERS } from 'utils/shared-enums.ts'

/** One of `iam`'s own OTP delivery channels — the real `NOTIFIERS` tuple
 * (`utils/shared-enums.ts`), a leaf module with zero imports of its own, safe for this
 * browser-facing component to import directly. */
export type OtpNotifierChannel = typeof NOTIFIERS[number]

/**
 * Props for the OTP resend Comet (`index.ts`/`index.preact.ts`) — see `render.ts`'s own doc for
 * the full "why this needed its own Comet" account. Every field is caller-supplied, so any real
 * OTP-login screen (`iam`'s own generic `OtpView`, or a consumer app's differently-styled one)
 * can reuse this unchanged.
 */
export type OtpResendProps = {
  /** The current locale segment — this Comet builds its own resend URL
   * (`/${lang}/login/otp/${email}/resend`) rather than taking one as a prop, since every real
   * caller's own route for that action follows this exact, fixed shape. */
  lang: string
  email: string
  csrfToken?: string
  /** Absolute epoch-ms instant the resend cooldown ends, resolved once by the caller's own
   * `loader` — `Countdown`'s own contract needs exactly this shape (see its own `target` doc for
   * why it's never a relative duration). `undefined`/already-past means a resend is available
   * immediately, no countdown ever renders. */
  cooldownEndsAt?: number
  /** Already-formatted (`formatMessage`) — this Comet has no i18n mechanism of its own, the same
   * "caller resolves locale text" contract `RateLimitCard`'s own `headingLabel`/`bodyLabel`
   * already establishes. */
  resendLabel: string
  cooldownLabel: string
  /** Forwarded straight through to `Countdown` — see its own `nonce` doc for the real CSP gap
   * this closes for the live cooldown countdown's own `aria-live` region. */
  nonce?: string
  /**
   * Every delivery channel actually deliverable for this account — the one that just dispatched
   * the pending code INCLUDED, e.g. `[{value:'email',...}, {value:'sms',...}]` for an account with
   * a verified phone. A single, ONE-BUTTON resend/channel-picker, never a separate action per
   * channel: rendered as a small `<select>` right next to the SAME resend button, pre-selected to
   * {@linkcode currentNotifier}, so clicking that one button resends through whichever channel is
   * currently selected. One link per channel would read as unrelated actions, and a `<select>`
   * with its OWN separate submit button would add a second, easy-to-miss action — see
   * `render.ts`'s own doc.
   *
   * Only meaningful, and only rendered as a picker at all, with 2+ entries — a single entry means
   * there's no real choice to offer, so the plain resend button renders with no picker. Omit, or pass an array of 0-1 entries, for that same
   * plain-button case.
   */
  notifierOptions?: { value: OtpNotifierChannel; label: string }[]
  /** Which of {@linkcode notifierOptions} starts pre-selected in the picker — the channel that
   * dispatched whatever code is currently pending. Ignored when `notifierOptions` has fewer than
   * 2 entries. */
  currentNotifier?: OtpNotifierChannel
  /** The picker's own accessible label, e.g. "Enviar por:" — required whenever
   * {@linkcode notifierOptions} has 2+ entries; ignored otherwise. */
  notifierPickerLabel?: string
}
