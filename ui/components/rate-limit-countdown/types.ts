/**
 * Props for the rate-limit countdown Comet (`index.ts`/`index.preact.ts`) — see `render.ts`'s own
 * doc for the full "why this needed its own Comet, and its own `onComplete`" contract. Every
 * field below is caller-supplied, so any form with its own rate-limited submit (the `login` page's
 * email/OTP step, its own password step, or an unrelated consumer app's form) can reuse this
 * unchanged.
 */
export type RateLimitCountdownProps = {
  /** Absolute epoch-ms instant the wait ends — `LoginView`'s own `liveRetryUntil`. */
  target: number
  /** `Countdown`'s own `size`/`strokeWidth` for its `variant='ring'` — `login/render.ts`'s
   * `RATE_LIMIT_RING_SIZE`/`RATE_LIMIT_RING_STROKE`, threaded through unchanged. */
  size: number
  strokeWidth: number
  /** This request's own CSP nonce — `Countdown`'s ring styling is a real, functional
   * self-rendered `<style nonce>` element (see that component's own doc). */
  nonce?: string
  /** The surrounding `<form>`'s own `id` (`login/render.ts`'s `FORM_ID`) — every `disabled` field
   * and the submit button inside it are re-enabled directly, via the DOM, the instant this
   * countdown reaches zero. See `render.ts`'s own doc for why this can't be plain Preact state
   * instead. */
  formId: string
  /** The rate-limit card's own root `data-space` value (`login/render.ts`'s
   * `'login-rate-limit'`) — hidden directly, via the DOM, alongside the form re-enabling above,
   * so the card doesn't sit there forever showing a countdown stuck at zero. */
  cardDataSpace: string
  /**
   * Query-string parameter NAMES (never values — this Comet has no opinion on what a consuming
   * app calls its own error/retry params, only that some should be dropped once this countdown
   * completes) to remove from the current URL via `history.replaceState` alongside the DOM work
   * above. Optional; defaults to removing nothing.
   *
   * Without it, the URL's own `?error=rate_limited&retryUntil=...` (or whatever a consumer names
   * its equivalent) stays stale in the address bar after the countdown completes, and a later
   * reload, bookmark, or shared link re-evaluates that stale `retryUntil` server-side — which, once
   * a fresh request starts a NEW rate-limit window, reads like a countdown that keeps looping.
   * Removing the params the instant the countdown completes leaves nothing rate-limit-shaped in the
   * URL to re-read.
   */
  clearQueryParamsOnComplete?: string[]
}
