# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/) and this project
adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The default stylesheet is authored as `ui/styles.css` and imported as text by `ui/styles.ts`
  (`import css from './styles.css' with { type: 'text' }`). `IAM_UI_CSS` and `iamCssSource` keep the
  same names and the same rules. An app that builds with `zanix space build` needs `@zanix/cli`
  2.2.8 or later: earlier versions read a `.css` import as a CSS Module and hand `cssSources` an
  empty stylesheet.

## [1.1.0] - 2026-10-02

### Added

- **`@zanix/iam/serve` runs a published version without cloning the repository.**
  `deno run jsr:@zanix/iam@<version>/serve --env-file=.env` downloads that version's files into a
  cache directory (`ZANIX_CACHE_DIR`, else `~/.cache/zanix`), checks each one against the SHA-256
  sum JSR publishes for it, and runs `mod.ts` from there; `--worker` runs `worker.ts` instead. A
  version is downloaded once, and a file that does not match leaves nothing in the cache. In a
  container, run it once at build time and start the service with `-- --cached-only`.

### Changed

- **The package now ships `.dist/client`**, the client bundle the hosted pages load (their scripts,
  stylesheet and manifests). It is git-ignored, so the publish workflow builds it first. Without it
  a downloaded copy served the pages with no client script or stylesheet.

## [1.0.4] - 2026-10-01

### Changed

- **`@zanix/asyncmq` range raised to `^0.9.1`** (`@zanix/asyncmq` and `@zanix/asyncmq/jobs`).
  `^0.8.0` excluded every 0.9 release, so a project already on `@zanix/asyncmq` 0.9 loaded a second
  copy of it next to the one this package imported, each with its own module-level state. The 0.9
  line adds automatic AMQP reconnection and delivers crons that were lost before the first worker
  booted.

## [1.0.3] - 2026-10-01

### Fixed

- **A permission code with a digit could never be created** — `POST /api/permissions`
  (`IsPermission`, `PERMISSION_REGEX`) accepted only letters and hyphens on each side of the colon,
  so a real module name such as `billing-portal` or `oauth2` answered `400` and no account could
  ever hold it. Digits are now allowed on both sides; underscores and other punctuation are still
  rejected.

## [1.0.2] - 2026-09-28

### Fixed

- **`handleOtpResendAction` silently swallowed an upstream dispatch failure** — a genuine
  `RestClientError` from `OtpClient.request` (a live case: `iam`'s own `sendBackgroundMessage`
  worker timing out) redirected back to the code page with nothing distinguishing it from a plain
  reload, unlike every other error state that page already renders a banner for
  (`invalidCode`/`rateLimited`/`unexpectedError`). A visitor whose resend genuinely failed saw no
  code arrive and no explanation why. Now redirects with `error=unexpected_error`, reusing
  `otpVerifyPageData`'s own existing banner — the same mechanism `handleOtpVerifyAction` already
  uses for an identical upstream fault during verification.

## [1.0.1] - 2026-09-26

### Fixed

- **`cookie-consent-modal` hardcoded its copy in English, never reading it from the message
  catalogs** — the one component whose accept/decline dialog didn't follow this package's own
  established convention (every other view resolves its text through `useIntl`). Now wired the same
  way, with new `cookie-consent-modal/{heading,body,accept,decline,error}` keys in both the English
  and Spanish catalogs.

### Changed

- **`cookie-consent-modal` now composes `@zanix/space-ui`'s shared `ConsentModal`** instead of
  assembling `Modal`/`Button` directly — the presentational shell (heading, body copy, the
  Accept/Decline/acknowledgement structure) was near-identical duplication with a second,
  independent consumer of the same shape; this package's own decision/submission logic is unchanged.
  Bumped `@zanix/space-ui` (`^2.1.0-rc.6` → `^2.4.0`), `@zanix/auth` (`^1.5.4` → `^1.6.0`), and the
  `@zanix/utils`-derived subpaths (`^4.5.0` → `^4.7.0`).

## [1.0.0] - 2026-09-26

First release of `@zanix/iam`: an identity and access management service that runs standalone or is
composed into another Zanix process, plus the views, Comets and headless SDK a `@zanix/space` app
uses to render its sign-in flow. `docs/api-reference.md` lists every subpath and symbol.

### Added

#### Authentication

- **Password login** with an optional OTP (email/SMS/WhatsApp) or TOTP (authenticator app) second
  factor, **passwordless OTP login**, and **OAuth2 login** (Google, GitHub), each provider enabled
  by its client id/secret/redirect URI. A second-factor challenge names its `method` (`'totp'` or
  the notifier a code was sent through), so a client routes to the right step.
- **Two-step sign-in**: `GET /login/methods/:email` answers which methods an email can sign in with,
  identically for an unknown email, rate limited by `LOGIN_METHODS_RATELIMIT`.
- **Self-registration** on a first successful OTP or OAuth2 sign-in. `SELF_REGISTRATION=false`
  closes it per instance by setting the default of the `selfRegistrationViaOTP` and
  `selfRegistrationViaOAuth` configs, both overridable at runtime. `DEFAULT_ROLE_ID` (config
  `defaultRoleId`) is the role a self-registered account receives; unset, the account has no role
  and no permissions.
- **Refresh-token session rotation** (`POST /login/refresh`) through `@zanix/auth`, re-resolving the
  account's permissions on every refresh so a role change applies on the next refresh.
- **Password recovery** and **passwordless account invites**: a profile registered without a
  password enters the recovery flow to set its own credential. A recovery request answers the same
  confirmation for every email, and the new password goes through `passwordPolicy`.
- **Self-service sign-in methods**: `GET /login/methods`, `POST /login/:oauth/link`,
  `DELETE /login/:oauth`, `POST /pwd/add`, `DELETE /pwd/remove`, TOTP enroll/disable, phone
  verification (`POST /login/phone/enroll`, `POST /login/phone/confirm`, `DELETE /login/phone`, the
  confirm route limited per caller by `freeRateLimit`) and the preferred OTP delivery channel
  (`POST /login/otp-notifier`).
- **Account lifecycle**: `PATCH /users/deactivate` and `DELETE /users` act on the caller's own
  account. A successful email OTP or Google OAuth2 identity check on a deactivated account returns a
  `ReactivationChallengeResult` instead of a session; `POST /login/reactivate` reactivates the
  account and completes the sign-in after the visitor confirms. A deleted account is not
  recoverable.
- **Hosted OAuth2 provider**: `GET /oauth/authorize` and `POST /oauth/token` let another host send
  its visitors through `iam`'s login pages and exchange the single-use code for a session. Clients
  are registered in `OAUTH_PROVIDER_CLIENTS` (a JSON array of client id, secret and allowed redirect
  URIs); unset, every authorize request is rejected.
- **Per-route rate-limit tiers**: every anonymous `LoginController` route has its own counter, and
  `GET /login/methods/:email` allows the two calls a two-step sign-in makes per attempt.

#### Authorization and accounts

- **RBAC catalog** (`roles`/`permissions`): a role bundles permission codes, flattened into the
  session token's `aud` claim. Every `RBAC_PERMISSIONS` code and a `superadmin` role are seeded. The
  evaluation strategy (`resolveEffectivePermissions`) is overridable per host.
- **Grant Access**: per-resource grants (`READ`/`WRITE`/`MANAGE`, optionally tenant-scoped), gated
  by `RBAC_PERMISSIONS.grantAccessRead`/`grantAccessWrite`.
- **Users**: profile registration, self-service and admin management, stored apart from the `auth`
  credential records.
- **Multi-tenancy**: `roles` and `grant-access` records optionally carry a `tenantId`.
- **Notification-template discovery** under `/.well-known/zanix/code-templates`, and a `/templates`
  CRUD API over database-backed overrides when `TEMPLATES_BACKEND=local`.

#### Composition

- `./auth-app` and `./grant-access-app` export the Zanix App manifests that compose `iam`'s
  auth/RBAC logic into another process; `./shared-enums` exports `OAUTH_PROVIDERS`, `NOTIFIERS` and
  `TWO_FACTOR_METHODS`. The backend exports import no UI file or renderer.
- **Hosted pages** for login, 2FA, recovery, phone verification, reactivation and cookie consent,
  built from the same exported views, catalogs and stylesheet as below. A consent dialog gates every
  session-issuing page; declining keeps the app usable with no session cookie.

#### Views and Comets

- **Pages** under `./ui/pages/*`: `lang-layout`, `consent`, `login`, `login-entry`,
  `login-oauth-start`, `login-oauth-callback`, `login-oauth-callback-error`, `login-otp`,
  `login-totp`, `login-reactivate-confirm`, `logout`, `password-recovery-request`,
  `password-recovery-callback`, `totp-enroll`, `totp-confirm`, `phone-enroll`, `phone-confirm`. Each
  has a React binding and a `/preact` binding built from one JSX-free `render.ts`.
- **`LoginView`**: `mode: 'password' | 'passwordless'` (an email-only form that dispatches a login
  code, with the OAuth2 providers as buttons above it), `noAccount`/`sessionExpired` banners, and
  independent `termsUrl`/`privacyUrl` links (the hosted app reads `PRIVACY_NOTICE_URL`). The Google
  button carries its mark as inline SVG and names the provider.
- **`LoginEntryView`** (`./ui/pages/login-entry`): the two-step sign-in screen — email step,
  password step and the `LoginTwoStep` Comet — inside a host-supplied frame, with
  `recoveryAction: false` for an app with no recovery page.
- Every error/status message renders `data-space="banner"` with a `data-variant` of `error`, `warn`
  (a temporary wait) or `info`.
- **Components** under `./ui/components/*`: `login-password-step`, `login-two-step`,
  `otp-code-field` (six-box code field), `otp-resend` (cooldown and delivery-channel picker),
  `rate-limit-countdown`, `rate-limit-card`, `password-toggle-field`, `auth-hidden-fields` and
  `cookie-consent-modal`.
- **Message catalogs** in English and Spanish (`./ui/sdk/messages`), worded without naming a
  product. `iamMessages` is a `@zanix/space` message source serving the catalogs compiled to ICU AST
  (`deno task gen:messages`); the app's own `messagesDir` wins key by key, adds languages, and a
  regional code falls back to its language.
- **`./ui/styles`** (`IAM_UI_CSS`, `iamCssSource`): the default stylesheet for every `data-space`
  hook, built on `--space-*` tokens and placed before the app's own CSS.

#### Headless SDK

- **Clients** for any framework: `LoginClient`, `OtpClient`, `TotpClient`, `PhoneClient`,
  `PasswordClient` and `UsersClient`, plus `./ui/sdk/validation` and the request/response shapes of
  every endpoint.
- **Login-flow logic** for an app that renders the views itself: `./ui/space/login-pages` (the
  `loader`/`action` bodies of every sign-in page, including `handleLogoutAction`),
  `./ui/sdk/login-flow`, `./ui/sdk/otp-channel`, `./ui/sdk/otp-flow-cache` (delivery-channel cache,
  resend cooldown, `seedNotifierMethods`, and a 30 s `DEGRADED_CACHE_SECONDS` window for a failed
  lookup) and `./ui/sdk/client-registry`. Everything that differs per app is an argument; a client
  may be passed lazily (`LazyClient`).
- **Session guards** (`./ui/sdk/session-guard`): `iamSessionGuard`/`iamOptionalSessionGuard` for an
  app that delegates sign-in to a separately deployed `iam`, refreshing through a rate-limit-aware,
  single-flight cache (`getOrRefreshIamTokens`, `seedIamSessionCache`).
- **Error handling**: `./ui/sdk/redirect-unauthorized` (`redirectIamUnauthorized`),
  `./ui/sdk/redirect-session-refresh-failure` and `./ui/sdk/error-handler` (`iamErrorHandler`, the
  whole `ssr.onError` chain in its required order).
- `./ui/sdk/session-helpers` (`requireAccessToken`, `requireOwnUserId`, `hasSessionCookie`) and
  `./ui/sdk/cookies-accepted-guard` (`cookiesAcceptedGuard`, for an app with no consent banner).

### Security

- `AuthService.loginWithOTPCallback` signs a verified OTP into the existing `auth` record for that
  email, however the account first authenticated. This auto-linking is safe only while every flow
  that adds a sign-in method confirms ownership of the inbox; its JSDoc documents the surface.

### Requirements

- `@zanix/auth@^1.5.4`, `@zanix/space@^1.16.0`, `@zanix/space-ui@^2.1.0-rc.6`,
  `@zanix/server@^4.3.0`.
