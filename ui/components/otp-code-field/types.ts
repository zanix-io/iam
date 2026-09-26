/**
 * Props for the shared six-box OTP/verification-code field Comet (`index.ts`/`index.preact.ts`) —
 * see `render.ts`'s own doc for the full "why one real input, not six" account.
 */
export type OtpCodeFieldProps = {
  /** Field name posted with the enclosing form — matches whatever RTO field the owning page's own
   * `@Page({ action: { Body } })` declares (`code`, typically). */
  name: string
  /** Number of digits — 6 for both `zanix/iam`'s own OTP and TOTP primitives today, passed rather
   * than hardcoded so a future differently-sized code never forces a fork of this file. */
  length: number
  /** Id of the enclosing `<form>` — auto-submitted via `requestSubmit()` once every digit is
   * filled, matching a real, common verification-code UX: no separate submit button needed. */
  formId: string
  /** Server-rendered initial error state (the previous submit came back invalid/expired) — the
   * boxes render in the host's own error color on mount and clear on the visitor's very next
   * keystroke; this Comet has no opinion on WHY the previous attempt failed, only whether to start
   * in that state. */
  initialError?: boolean
  /** This field's own accessible name — `zanix/iam` has no i18n mechanism of its own to derive one
   * from (same "no i18n mechanism" contract `@zanix/space-ui`'s own `PasswordInput.getToggleLabel`/
   * `SocialLinksInput` already establish), so the owning page's own `formatMessage` call supplies
   * it, already resolved, before this Comet's props are serialized. */
  ariaLabel: string
  /** Disables the real underlying input (and, via `data-disabled`, the decorative boxes a host's
   * own CSS may want to visually dim) — for a rate-limited verify attempt, the same "disable the
   * form while a countdown is active" contract `PasswordToggleField`/`Input` already support
   * elsewhere in this package (`login/render.ts`'s own `formDisabled`). `undefined`/`false` leaves
   * the field enabled. */
  disabled?: boolean
}
