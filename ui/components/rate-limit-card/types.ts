import type { RateLimitCountdownProps } from 'ui/components/rate-limit-countdown/types.ts'

/** Every field {@linkcode RateLimitCountdownProps} already takes, forwarded straight through to
 * the composed `RateLimitCountdown`, plus the two caller-supplied copy strings this card wraps it
 * with. Both strings are already-resolved (never a `formatMessage` call or key) — the same
 * "caller resolves i18n, passes plain strings" contract `RateLimitCountdown` itself establishes
 * for its own `onComplete` announcement, applied here because two real, distinct consumers
 * (`LoginView`'s own email/OTP step, and a host app's OWN differently-worded password step) need
 * genuinely different copy for the same visual card. */
export type RateLimitCardProps = RateLimitCountdownProps & {
  /** e.g. the `login/rate-limited/heading` message — rendered as
   * `data-space="login-rate-limit-heading"`. */
  headingLabel: string
  /** e.g. the `login/rate-limited/body` message ("You can try again in:") — rendered
   * as `data-space="login-rate-limit-body"`,
   * directly above the countdown it's the lead-in sentence for. */
  bodyLabel: string
}
