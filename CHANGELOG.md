# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/) and this project
adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

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
