/**
 * Props for the login page's rate-limit countdown Comet (`index.ts`/`index.preact.ts`) — see
 * `render.ts`'s own doc for the full "why this needed its own Comet, and its own `onComplete`"
 * contract.
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
}
