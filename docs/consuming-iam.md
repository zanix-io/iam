## Consuming `iam` from another system

`iam` deploys and runs on its own (`deno task dev`/`deno task start`, or built via
`zanix space build`), but another system can also integrate with it directly, at three different
levels — pick whichever matches how much control you need over the login experience. The three are
not mutually exclusive: a host can start with the zero-code option and move to a deeper one later
without `iam` changing anything on its side.

|               | Hosted redirect             | Direct page/component import                               | Headless SDK                                               |
| ------------- | --------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| Code required | None                        | Low (must already use Preact or React)                     | Real UI work, any framework                                |
| User sees     | `iam`'s own domain, briefly | Your app, seamlessly                                       | Your app, seamlessly                                       |
| Branding      | `IAM_THEME` env var only    | Full — your own layout                                     | Full — your own everything                                 |
| Backend logic | Yours, calling `iam`'s API  | Yours, calling `iam`'s API — see the rate-limit note below | Yours, calling `iam`'s API — see the rate-limit note below |

### 1. Hosted redirect — no code

Send an unauthenticated visitor to `iam`'s own login page and get them back with a session, the same
shape `iam` itself already uses to log in via Google/GitHub OAuth2 — `iam` plays the provider role
here instead of the consumer role:

1. Redirect to `GET /oauth/authorize?client_id=...&redirect_uri=...&state=...`
   ([`oauth-provider.handler.ts`](../src/server/handlers/oauth-provider.handler.ts)). `client_id`
   and `redirect_uri` must already be registered — see that handler's own doc for the env-JSON
   client registry.
2. The visitor authenticates on `iam`'s own hosted pages (rebrand them without a build by setting
   `IAM_THEME`, a JSON-valued env var — see [`utils/constants.ts`](../src/utils/constants.ts)'s
   `resolveThemeOverrides`).
3. `iam` redirects back to `redirect_uri` with a short-lived, single-use code.
4. Your backend exchanges it: `POST /oauth/token` with `client_id`/`client_secret`/the code —
   returns the same `{accessToken, refreshToken, expiresAt}` shape `iam`'s own login endpoints do.

No consent screen is shown — acceptable only because client registration is operator-curated, not
self-service (see the handler's own doc for the trade-off this implies). `state` is relayed back to
you unvalidated by `iam` — validate it yourself, it's your own CSRF token per RFC 6749.

### 2. Direct page/component import — React or Preact, near-zero code

If your app already uses React or Preact, import `iam`'s real login/2FA/password-recovery pages (or
just the pieces you need) straight into your own `@zanix/space` routes — no redirect, no domain
switch. Every one of these ships in BOTH renderers from the same source, with zero JSX in the
published files (a shared `render.ts` factory per page/component, plus a thin `index.ts` React
binding and `index.preact.ts` Preact binding) — pick whichever subpath matches your stack.

Full pages, one subpath pair per page, all under `@zanix/iam/ui/pages/*` (see
[`ui/pages/`](../ui/pages/)): `lang-layout`, `consent`, `login`, `login-oauth-start`,
`login-oauth-callback`, `login-oauth-callback-error`, `login-otp`, `login-totp`, `logout`,
`password-recovery-request`, `password-recovery-callback`, `totp-confirm`, `totp-enroll` — each has
a `/preact` sibling (e.g. `@zanix/iam/ui/pages/login/preact`).

Granular pieces, for composing into your own layout instead of taking a whole page: currently
`@zanix/iam/ui/components/cookie-consent-modal` (+ `/preact`) — see
[`ui/components/`](../ui/components/).

`iam`'s own hosted pages (option 1) are built from these exact same exports — there is no separate,
parallel copy to drift from what you'd import.

### 3. Headless SDK — any framework, most integration work

Build your own UI, in whatever framework you use, against a typed client for `iam`'s real
login/OTP/TOTP/password-recovery API — no JSX, no `@zanix/space` dependency at all. See
[`ui/sdk/`](../ui/sdk/) for the full RTOs/clients/validation/messages.

```ts
import { LoginClient } from '@zanix/iam/ui/sdk/login'
import { validateEmail, validatePassword } from '@zanix/iam/ui/sdk/validation'
```

Available subpaths: `@zanix/iam/ui/sdk/login`, `/otp`, `/totp`, `/password-recovery`, `/validation`,
`/messages` — each documents which real `iam` endpoint it calls and the exact request/response
shape, verified against `iam`'s own generated OpenAPI spec rather than assumed from source.
`grant-access`/`permissions`/`roles`/`users` are deliberately out of scope here (admin-only, not
part of the login/2FA/recovery surface this SDK targets).

### Rate limiting — read this if you proxy `refresh` through your own backend

`iam`'s sensitive endpoints run under a strict `criticRateLimit` (default: 1 request per
anonymous-bucket window — see `CRITIC_RATELIMIT_ENV`,
[`utils/constants.ts`](../src/utils/constants.ts)). Two things that matter for Tier 2/3 consumers
specifically:

- **Call `refresh` only when the access token is actually near/at expiry, not unconditionally on
  every guarded page view.** `expiresAt` on every session-tokens response tells you exactly how long
  is left (seconds, not an absolute timestamp — see `rtos/login.ts`'s own doc); cache the token and
  its expiry, and only call `refresh` once that window is actually closing. Calling it per page view
  will exhaust `criticRateLimit` for real, legitimate traffic almost immediately.
- **If your own backend proxies `POST /login/refresh` on behalf of many different end users** (a
  normal SSR/BFF pattern — the same shape `iam`'s own pages use, calling `AuthService` server-side):
  pass the refresh `token` explicitly to `ui/sdk`'s `LoginClient.refresh(token)` (not
  `undefined`/cookie-only) — the client automatically sends it via the `X-Znx-App-Token`
  header/cookie too, which `iam`'s own `refreshRateLimitIdentityGuard`
  ([`utils/refresh-rate-limit-guard.ts`](../src/utils/refresh-rate-limit-guard.ts)) reads to key the
  rate limit by the token's real subject instead of your backend's own IP — each of your real end
  users gets their own bucket, not one shared across your whole user base. Only
  `POST /login/refresh` needs this (the one `criticRateLimit`-guarded endpoint whose identity
  arrives in the request body, where a guard genuinely can't see it in time otherwise) — every other
  endpoint either has no body-only identity to key off of, or already runs under a real, established
  session.

### Backend-only composition (auth/grant-access logic, no UI at all)

Orthogonal to all three tiers above: if you only need `iam`'s auth/RBAC logic composed into your own
Zanix App process (no UI, no redirect), import the manifests directly — `jsr:@zanix/iam/auth-app` /
`jsr:@zanix/iam/grant-access-app` — and pass them to your own `Zanix.start()`/`activateApps()`, with
your own `behaviors`/`config` overrides. See
[`server/apps/auth.app.ts`](../src/server/apps/auth.app.ts) and
[`grant-access.app.ts`](../src/server/apps/grant-access.app.ts) for the full override surface.
