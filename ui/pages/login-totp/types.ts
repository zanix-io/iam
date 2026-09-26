/** Props {@linkcode createTotpLoginView}'s returned view expects — the exact shape `iam`'s own
 * `LoginTotpPage.loader` (`space/routes/[lang]/login/totp/[email]/page.tsx`) resolves. */
export type TotpViewProps = {
  lang: string
  email: string
  csrfToken?: string
  fieldErrors?: Record<string, unknown>
  invalidCode: boolean
  /** `true` when the owning page's own `action` caught `zanix/iam`'s real
   * `POST /login/totp/callback` rejecting with `429 Too Many Requests` — same real, reachable case
   * `LoginViewProps.rateLimited`'s own doc describes for the password/passwordless entry point,
   * here for a mistyped authenticator code a couple of times in a row instead. Distinct from
   * {@link invalidCode} both in cause and in what the visitor should actually do next (wait, not
   * retype). */
  rateLimited: boolean
  /** `true` when the owning page's own `action` caught an upstream failure from
   * `POST /login/totp/callback` that's neither {@link invalidCode} nor {@link rateLimited} —
   * `zanix/iam` unreachable, a genuine `5xx`, or any other real fault. Same reasoning as
   * `LoginViewProps.unexpectedError`. */
  unexpectedError: boolean
  /** The absolute instant (epoch milliseconds) at which {@link rateLimited} clears — same
   * `Countdown.target`-shaped contract as `LoginViewProps.retryUntil`, computed once, server-side,
   * at the moment the real `Retry-After` header was read. `undefined` falls back to the plain
   * static rate-limited message with no live countdown. */
  retryUntil?: number
  /** Query-string parameter NAMES the owning page uses to carry {@link rateLimited}/
   * {@link retryUntil} into this URL — forwarded unchanged to `RateLimitCard`'s own
   * `clearQueryParamsOnComplete`. Same contract as `LoginViewProps.clearQueryParamsOnRateLimitComplete`. */
  clearQueryParamsOnRateLimitComplete?: string[]
  /** This request's own CSP nonce — same contract as `LoginViewProps.nonce`, forwarded to
   * `RateLimitCard`'s own `Countdown`. */
  nonce?: string
}
