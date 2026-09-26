## Consuming `iam` from another system

`iam` deploys and runs on its own (`deno task dev`/`deno task start`, or built via
`zanix space build`), but another system can also integrate with it directly, at three different
levels — pick whichever matches how much control you need over the login experience. The three are
not mutually exclusive: a host can start with the zero-code option and move to a deeper one later
without `iam` changing anything on its side.

REST paths in this guide are relative to `iam`'s REST prefix, `/api` by default
(`POST /login/refresh` is served at `/api/login/refresh`; see the
[REST API reference](./rest-api.md)). An SDK client's `baseUrl` includes that prefix. Every exported
symbol is listed in the [API reference](./api-reference.md).

|               | Hosted redirect             | Direct page/component import                               | Headless SDK                                               |
| ------------- | --------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| Code required | None                        | Low (must already use Preact or React)                     | Real UI work, any framework                                |
| User sees     | `iam`'s own domain, briefly | Your app, seamlessly                                       | Your app, seamlessly                                       |
| Branding      | `IAM_THEME` env var only    | Full — your own layout                                     | Full — your own everything                                 |
| Backend logic | Yours, calling `iam`'s API  | Yours, calling `iam`'s API — see the rate-limit note below | Yours, calling `iam`'s API — see the rate-limit note below |

### 1. Hosted redirect — no code

Send an unauthenticated visitor to `iam`'s own login page and get them back with a session: `iam`
acts as an OAuth2 authorization server for your host. The operator registers your `client_id`,
`client_secret` and redirect URIs in `OAUTH_PROVIDER_CLIENTS`; your app redirects the browser to
`GET /api/oauth/authorize`, and your backend exchanges the returned code at `POST /api/oauth/token`
for the same `{ accessToken, refreshToken, expiresAt }` every sign-in returns. Validate `state`
yourself. The full sequence and its security trade-offs are in
[Authentication flows](./authentication-flows.md#hosted-oauth2-provider). Rebrand the hosted pages
without a build with `IAM_THEME` and `IAM_MESSAGES` ([Customization](./customization.md)).

### 2. Direct page/component import — React or Preact, near-zero code

If your app already uses React or Preact, import `iam`'s login/2FA/password-recovery pages (or just
the pieces you need) straight into your own `@zanix/space` routes — no redirect, no domain switch.
Every one of these ships in BOTH renderers from the same source, with zero JSX in the published
files (a shared `render.ts` factory per page/component, plus a thin `index.ts` React binding and
`index.preact.ts` Preact binding) — pick whichever subpath matches your stack.

Full pages, one subpath pair per page, all under `@zanix/iam/ui/pages/*` (see
[`ui/pages/`](../ui/pages/)): `lang-layout`, `consent`, `login`, `login-entry`, `login-oauth-start`,
`login-oauth-callback`, `login-oauth-callback-error`, `login-otp`, `login-totp`,
`login-reactivate-confirm`, `logout`, `password-recovery-request`, `password-recovery-callback`,
`totp-confirm`, `totp-enroll`, `phone-enroll`, `phone-confirm` — each has a `/preact` sibling (e.g.
`@zanix/iam/ui/pages/login/preact`).

Granular pieces, for composing into your own layout instead of taking a whole page, all under
`@zanix/iam/ui/components/*` (see [`ui/components/`](../ui/components/)), each with a `/preact`
sibling: `cookie-consent-modal`, `password-toggle-field`, `otp-code-field`, `otp-resend`,
`rate-limit-countdown`, `rate-limit-card`, `auth-hidden-fields`, `login-password-step`,
`login-two-step`. The [API reference](./api-reference.md#components) describes each one.

`iam`'s own hosted pages (option 1) are built from these exact same exports — there is no separate,
parallel copy to drift from what you'd import.

#### Messages and default styles

Register `iam`'s catalogs and stylesheet in your `defineSpaceApp` (`messageSources: [iamMessages]`,
`cssSources: [iamCssSource]`); your own `messagesDir` and CSS override them key by key and rule by
rule. How overriding, languages, `data-space` hooks and `--space-*` tokens work is described in
[Customization](./customization.md).

### 3. Headless SDK — any framework, most integration work

Build your own UI, in whatever framework you use, against typed clients for `iam`'s
login/OTP/TOTP/phone/password-recovery API — no JSX, no `@zanix/space` dependency at all. See
[`ui/sdk/`](../ui/sdk/) for the full RTOs/clients/validation/messages.

```ts
import { LoginClient } from '@zanix/iam/ui/sdk/login'
import { validateEmail, validatePassword } from '@zanix/iam/ui/sdk/validation'

const login = new LoginClient({ baseUrl: 'https://iam.example.com/api' })
const result = await login.login('user@example.com', 'correct horse battery staple')
if ('accessToken' in result) {
  // signed in: store result.accessToken / result.refreshToken
} else {
  // a second-factor challenge: continue with OtpClient.verify or TotpClient.verifyLogin
}
```

Available subpaths: `@zanix/iam/ui/sdk/login`, `/otp`, `/totp`, `/phone`, `/password-recovery`,
`/users` (the caller's own account deactivation and deletion), `/validation`, and `/messages` (the
catalogs, plain data in `en` and `es`) — each documents which `iam` endpoint it calls and the exact
request/response shape. The admin endpoints of `grant-access`/`permissions`/`roles`/`users` are out
of scope for this SDK, which covers the sign-in, second-factor, recovery and self-service account
surface.

### `@zanix/space` session guards and error handling

If your host is a `@zanix/space` app, `iamSessionGuard`/`iamOptionalSessionGuard`
([`ui/sdk/session-guard`](../ui/sdk/session-guard.ts)) implement everything the
[Rate limiting](#rate-limiting--read-this-if-you-proxy-refresh-through-your-own-backend) section
below recommends — refresh caching, single-flight de-dup, `429` handling, rotated-cookie recovery —
as drop-in `MiddlewareGlobalGuard`s. They are the delegated-issuer counterpart to `@zanix/auth`'s
own `pageSessionGuard`/`optionalSessionGuard`, which verify and rotate tokens locally and therefore
suit only an app that is its own issuer. Call `seedIamSessionCache` right after a sign-in completes
so the next guarded page view needs no refresh call.

For the `ssr.onError` side, [`ui/sdk/error-handler`](../ui/sdk/error-handler.ts)'s `iamErrorHandler`
assembles the whole chain in the order it has to run: rotated-cookie recovery, your own handlers,
`redirectIamUnauthorized` ([`ui/sdk/redirect-unauthorized`](../ui/sdk/redirect-unauthorized.ts)) for
a missing or expired session, `redirectSessionRefreshFailure` for an upstream refresh failure, a
stale-CSRF retry, and your not-found page.

Read the Rate limiting section if you proxy `refresh` some other way (a non-`@zanix/space` backend,
say).

### Login-flow logic — the `loader`/`action` of the pages you render yourself

Rendering `iam`'s views inside your own routes (option 2) still leaves you the logic around them:
the `loader` data, the `action` that talks to `iam`, redirects, error states, the caches a code
screen needs. These ship next to the views:

- [`ui/space/login-pages`](../ui/space/login-pages.ts): `totpLoginPageData` +
  `handleTotpLoginAction`, `oauthStartPageData` + `handleOauthStartAction` (with
  `buildOauthStateSetCookieHeader`), `reactivatePageData` + `handleReactivateAction`,
  `handleOtpResendAction`, `handlePasswordLoginAction`, `markSessionRevoked`, and for the two-step
  sign-in page `loginEntryPageData` + `handleLoginEntryAction`, `handleLoginMethodsAction`,
  `handleRecoveryRequestAction`, `otpVerifyPageData` + `handleOtpVerifyAction`.
- [`ui/sdk/login-flow`](../ui/sdk/login-flow.ts): `redirect_to` handling
  (`resolvePostLoginRedirect`, `withRedirectToParam`), the shared `error` states and `retryUntil`
  round trip, `decodeEmailParam`, `redirectResponse`.
- [`ui/sdk/otp-channel`](../ui/sdk/otp-channel.ts): which channel a pending code travels on.
- [`ui/sdk/otp-flow-cache`](../ui/sdk/otp-flow-cache.ts): the delivery-channel lookup cache and the
  resend cooldown. `handleLoginEntryAction`'s `seedNotifierMethods` option stores the channels its
  own lookup returned, so the code screen reads them from the cache instead of calling the
  rate-limited lookup endpoint again.
- [`ui/sdk/redirect-session-refresh-failure`](../ui/sdk/redirect-session-refresh-failure.ts): the
  `onError` handler for a refresh that failed upstream, the sibling of `redirectIamUnauthorized`.
- [`ui/sdk/client-registry`](../ui/sdk/client-registry.ts): the `iam` clients of one deployment
  behind get/set/reset seams for tests.
- [`ui/sdk/login`](../ui/sdk/login.ts) also exports `EntryFormRTO` (email, optional password) and
  `EmailFormRTO` (email only), the `@Page` action bodies of those forms.
- [`ui/sdk/session-helpers`](../ui/sdk/session-helpers.ts) and
  [`ui/sdk/cookies-accepted-guard`](../ui/sdk/cookies-accepted-guard.ts): the session reads a page
  needs (`requireAccessToken`, `requireOwnUserId`, `hasSessionCookie`) and the global guard for an
  app with no consent banner. `handleLogoutAction` in `ui/space/login-pages` is the sign-out
  `action`.
- [`ui/pages/login-entry`](../ui/pages/login-entry/render.ts): the whole two-step sign-in screen
  (`LoginEntryView`) — render it inside your `IntlProvider` with your own `Card`, and pair it with
  `loginEntryPageData` / `handleLoginEntryAction`. The pieces below are what it composes; use them
  directly only for a different arrangement.
- [`ui/components/login-password-step`](../ui/components/login-password-step/render.ts) and
  [`ui/components/login-two-step`](../ui/components/login-two-step/render.ts): the password step of
  a two-step sign-in, and the headless Comet that swaps it in for the email step without a reload.
  The step takes every string as a `labels` prop and every class, id and route as an optional
  `options` field (`recoveryAction: false` drops "forgot password" for an app with no recovery
  page). Both toggle through the `data-login-step` / `data-login-email-display` DOM hooks, so the
  page renders the email step (`LoginView`) in a `data-login-step="email"` block next to it.

You keep the page class (route, decorators, head, layout) and call these from it:

```ts
import type { PageActionContext, PageContext } from '@zanix/space'
import { csrfGuard, loadMessages, Page, SpacePageController } from '@zanix/space'
import { Guard } from '@zanix/server'
import { TotpLoginRTO } from '@zanix/iam/ui/sdk/totp'
import { handleTotpLoginAction, totpLoginPageData } from '@zanix/iam/ui/space/login-pages'
// Your own: the view wrapping iam's TotpLoginView, and the client registry built with
// createIamClientRegistry (@zanix/iam/ui/sdk/client-registry).
import { TotpPageView } from './view.ts'
import { getTotpClient } from '../../../iam-clients.ts'

type TotpParams = { lang: string; email: string }

@Page({ action: { Body: TotpLoginRTO, onError: 'render' } })
@Guard(csrfGuard())
export default class LoginTotpPage extends SpacePageController<TotpParams> {
  public override component = TotpPageView // your layout around iam's TotpLoginView
  public override loader = async (ctx: PageContext<TotpParams>) => ({
    ...totpLoginPageData(ctx),
    messages: await loadMessages({ lang: ctx.params.lang, population: ctx.population }),
  })
  public override action = (ctx: PageActionContext<TotpParams>) =>
    handleTotpLoginAction(ctx, {
      totpClient: getTotpClient(),
      code: (ctx.body as TotpLoginRTO).code,
      defaultPath: `/${ctx.params.lang}/dashboard`,
    })
}
```

**What is yours to customize, and where.** These modules render no markup and bake in no message key
(a test enforces both), and they name no consumer. Everything that identifies your app is an
argument or stays in your route:

- **Text**: the views take every string from the `IntlProvider` messages you load, so your catalog
  (and your `loadMessages`) decides the wording and languages. The logic only ever reports states
  (`invalidCode`, `rateLimited`, `unexpectedError`, `expired`), never copy.
- **Styles and layout**: the views are content components; the card, page chrome, classes and CSS
  around them are your own route's.
- **Behavior that differs per app**: the landing page (`defaultPath` / `successPath`), the failure
  page, the cache `keyPrefix` and Redis choice, the fallback language, your own login path, which
  clients are used (through the registry), and the cooldown and cache windows.

### Rate limiting — read this if you proxy `refresh` through your own backend

`iam`'s sensitive endpoints run under a strict `criticalRateLimit` (default: 1 request per
anonymous-bucket window — see `CRITICAL_RATELIMIT_ENV`,
[`utils/constants.ts`](../src/utils/constants.ts)). Two things matter for consumers of options 2 and
3:

- **Call `refresh` only when the access token is actually near/at expiry, not unconditionally on
  every guarded page view.** `expiresAt` on every session-tokens response tells you exactly how long
  is left (seconds, not an absolute timestamp — see `LoginSuccessResult.expiresAt` in
  [`ui/sdk/rtos/login.ts`](../ui/sdk/rtos/login.ts)); cache the token and its expiry, and only call
  `refresh` once that window is actually closing. Calling it per page view will exhaust
  `criticalRateLimit` for real, legitimate traffic almost immediately.
- **If your own backend proxies `POST /login/refresh` on behalf of many different end users** (a
  normal SSR/BFF pattern — the same shape `iam`'s own pages use, calling `AuthService` server-side):
  pass the refresh `token` explicitly to `ui/sdk`'s `LoginClient.refresh(token)` (not
  `undefined`/cookie-only) — the client automatically sends it via the `X-Znx-App-Token`
  header/cookie too, which `iam`'s own `refreshRateLimitIdentityGuard`
  ([`utils/refresh-rate-limit-guard.ts`](../src/utils/refresh-rate-limit-guard.ts)) reads to key the
  rate limit by the token's own subject instead of your backend's own IP — each of your end users
  gets their own bucket, not one shared across your whole user base. Only `POST /login/refresh`
  needs this (the one `criticalRateLimit`-guarded endpoint whose identity arrives in the request
  body, where a guard genuinely can't see it in time otherwise) — every other endpoint either has no
  body-only identity to key off of, or already runs under a real, established session.

### Backend-only composition (auth/grant-access logic, no UI at all)

Orthogonal to the three levels above: `@zanix/iam/auth-app` and `@zanix/iam/grant-access-app` export
the App manifests for your own `Zanix.start()`, with your own behavior overrides. The manifests
carry no routes; what they include is described in
[Deployment](./deployment.md#composing-the-manifests).

### See also

- [API reference](./api-reference.md) — every subpath and symbol.
- [Authentication flows](./authentication-flows.md) — every sign-in flow end to end.
- [REST API reference](./rest-api.md) — every endpoint.
- [Customization](./customization.md) — messages, styles and behaviors.
- [`See more`](./see-more.md) — where each concern is implemented in the source.
- [README](../README.md)
