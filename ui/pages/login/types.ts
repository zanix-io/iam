/** Props {@linkcode createLoginView}'s returned view expects — the exact shape `iam`'s own
 * `LoginPage.loader` (`space/routes/[lang]/login/page.tsx`) resolves. */
export type LoginViewProps = {
  lang: string
  csrfToken?: string
  fieldErrors?: Record<string, unknown>
  submitted?: Record<string, string>
  invalidCredentials: boolean
  /** `true` when the owning page's own `action` caught `zanix/iam`'s real `POST /login/login`
   * rejecting with `429 Too Many Requests` (`freeRateLimit`, this project's own anonymous-request
   * rate limit — `criticRateLimit`'s own doc, `utils/constants.ts`) — a genuinely reachable real
   * case (a mistyped password a couple of times in a row), distinct from {@link invalidCredentials}
   * both in cause and in what the visitor should actually do next (wait, not retype), so it renders
   * its own message rather than being folded into that one. */
  rateLimited: boolean
  /** `true` when the owning page's own `action` caught an upstream failure from
   * `POST /login/login` that's neither {@link invalidCredentials} (`403`) nor {@link rateLimited}
   * (`429`) — `zanix/iam` unreachable, a genuine `5xx`, or any other real fault. Distinct from both:
   * neither "wrong password" nor "wait and retry" is accurate here, so it renders its own generic
   * message rather than being folded into either. Exists so a consuming page's own `action` never
   * has to let that raw upstream error reach the visitor as an unhandled JSON error page — see
   * `login/page.tsx`'s own doc (this package's real consumer) for the full contract. */
  unexpectedError: boolean
  /**
   * The absolute instant (epoch milliseconds — `Countdown.target`'s own already-resolved-instant
   * contract, never a relative duration) at which {@link rateLimited} clears, when the owning
   * page's own `action` was able to read it from the real `Retry-After` response header
   * `rateLimitGuard` (`@zanix/auth`) sends on a `429`. Computed ONCE, server-side, at the moment
   * that header was read (`Date.now() + retryAfterSeconds * 1000`) — never re-derived here or
   * anywhere downstream, so it stays accurate through the redirect round-trip that carries it to
   * this view. `undefined` (a `429` with no readable `Retry-After`, or a Tier-2 consumer not
   * wired to thread it through yet) falls back to the plain static `login/rate-limited` message
   * with no live countdown — same graceful degradation `oauthProviders` already establishes for
   * "this host doesn't have X configured yet".
   */
  retryUntil?: number
  /** Which OAuth2 providers this host actually has configured — resolved server-side by the
   * owning page's own `loader`, never hardcoded, so a deployment configuring only one provider (or
   * none) doesn't render a dead "Continue with..." link. */
  oauthProviders: readonly string[]
  /** This host's own Terms and Conditions URL. `undefined` renders no link at all — purely
   * informational, never a submit-blocking requirement. */
  termsUrl?: string
  /** This host's own Privacy Notice URL, rendered alongside {@link termsUrl} when both are given.
   * `undefined` renders no link at all — same purely-informational contract as `termsUrl`, and
   * independent of it: a host may set either, both, or neither. */
  privacyUrl?: string
  /**
   * Overrides the `<h1>` heading directly — for a Tier-2 consumer (importing this view straight
   * into their own `@zanix/space` routes, per `docs/consuming-iam.md`) that deliberately never
   * runs `iam`'s own backend in-process, and so has no `activateApps()` composition to register a
   * `loginHeading` {@link https://jsr.io/@zanix/app behavior} override through — see
   * `render.ts`'s own doc for why that mechanism alone isn't reachable from that tier. Takes
   * precedence over the `behaviors` override when both are present; omit to keep using
   * `behaviors`/the `'Sign in'` default.
   */
  heading?: string
  /** This request's own CSP nonce (`ctx.cspNonce`, `@zanix/space`'s `PageContext`) — forwarded to
   * `Countdown`'s own `nonce` prop (its `'ring'` variant's own stroke styling and visually-hidden
   * live region both need it) and, via `PasswordToggleField`, to the composed `PasswordInput`'s own
   * `nonce` prop (its default eye/eye-off icon strokes need it — `PasswordToggleFieldProps` widens
   * `PasswordInputBaseProps` and forwards every prop it doesn't otherwise touch, `nonce` included).
   * Both are ultimately `@zanix/space-ui` components whose own functional styling lives in a
   * self-rendered `<style nonce={nonce}>` element, never an inline `style` attribute, which a
   * nonce-based `style-src` CSP (`@zanix/space`'s own zero-config default is exactly this shape)
   * blocks unconditionally. `undefined` when the consuming page runs no such CSP, or hasn't wired
   * this prop through yet — both components still render, just without that nonce, which a strict
   * CSP would then block (a real, if easy-to-miss, degradation — see each component's own `nonce`
   * doc). */
  nonce?: string
}
