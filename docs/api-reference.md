## API reference

Every public subpath of `@zanix/iam` and every symbol it exports, grouped by concern. Each symbol's
own JSDoc (`deno doc jsr:@zanix/iam/<subpath>`) holds the full contract; this page maps where each
one lives. For how the pieces fit together, see [`Consuming iam`](./consuming-iam.md).

Every `ui/pages/*` and `ui/components/*` subpath ships a React binding (`index.ts`) and a Preact
binding under the same subpath plus `/preact` (e.g. `@zanix/iam/ui/pages/login/preact`), with the
same exports and the same markup.

REST paths below are relative to `iam`'s REST prefix (`/api` by default). An SDK client's `baseUrl`
includes that prefix, e.g. `new LoginClient({ baseUrl: 'https://iam.example.com/api' })`.

### Contents

- [Server](#server)
- [Pages](#pages)
- [Components](#components)
- [SDK clients and request/response shapes](#sdk-clients-and-requestresponse-shapes)
- [Messages, styles and validation](#messages-styles-and-validation)
- [Session guards and error handling](#session-guards-and-error-handling)
- [Login-flow helpers](#login-flow-helpers)
- [Page loaders and actions](#page-loaders-and-actions)
- [See also](#see-also)

### Server

| Subpath              | Export                                               | What it is                                                                                                                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`                  | —                                                    | The deployable entrypoint (`mod.ts`): starts the REST controllers, the `auth`/`grant-access` apps and the `@zanix/space` frontend with `Zanix.start()`. Run it; it exports nothing.                                                                                                         |
| `./auth-app`         | `default`                                            | The `auth` Zanix App manifest: OAuth2/captcha resources, config (`totpToleranceSteps`, `selfRegistrationViaOAuth`, `selfRegistrationViaOTP`, `defaultRoleId`), overridable behaviors (`passwordPolicy`, `totpProvisioningLabel`, `resolveEffectivePermissions`) and notification templates. |
| `./grant-access-app` | `default`                                            | The `grant-access` Zanix App manifest, including the overridable `evaluateGrantAccess` behavior.                                                                                                                                                                                            |
| `./shared-enums`     | `OAUTH_PROVIDERS`, `NOTIFIERS`, `TWO_FACTOR_METHODS` | Dependency-free constants shared by server and browser code: the OAuth2 providers `iam` wires, the OTP delivery channels (`email`/`sms`/`whatsapp`), and every second-factor method (the notifiers plus `totp`).                                                                            |

### Pages

Full screens. Each takes its wording from the `IntlProvider` messages the host loads (see
[Messages and default styles](./consuming-iam.md#messages-and-default-styles)).

| Subpath                                 | Exports                                                   | Screen                                                                                                                                                 |
| --------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `./ui/pages/lang-layout`                | `LangLayout`, `LangLayoutViewData`, `LangLayoutViewProps` | The `[lang]` layout: the `IntlProvider` around every page, plus a slot for the cookie-consent Comet the owning route builds.                           |
| `./ui/pages/consent`                    | `ConsentView`, `ConsentViewProps`                         | Cookie-consent fallback page.                                                                                                                          |
| `./ui/pages/login`                      | `LoginView`, `LoginViewProps`                             | Sign-in form, in `'password'` (email and password) or `'passwordless'` (email only, OAuth2 buttons first) mode, with optional terms and privacy links. |
| `./ui/pages/login-entry`                | `LoginEntryView`, `LoginEntryViewProps`, `LoginEntryData` | The two-step sign-in screen: `LoginView` as the email step, the password step and the `LoginTwoStep` Comet.                                            |
| `./ui/pages/login-oauth-start`          | `OauthStartView`, `OauthStartViewProps`                   | The OAuth2 start page whose form asks `iam` for the provider's authorization URL.                                                                      |
| `./ui/pages/login-oauth-callback`       | `OauthCallbackView`, `OauthCallbackViewProps`             | The OAuth2 callback interstitial.                                                                                                                      |
| `./ui/pages/login-oauth-callback-error` | `OauthCallbackErrorView`, `OauthCallbackErrorViewProps`   | The OAuth2 callback error boundary.                                                                                                                    |
| `./ui/pages/login-otp`                  | `OtpView`, `OtpViewProps`                                 | One-time-code challenge: destination, code field, resend and channel picker.                                                                           |
| `./ui/pages/login-totp`                 | `TotpLoginView`, `TotpViewProps`                          | Authenticator-app code challenge at sign-in.                                                                                                           |
| `./ui/pages/login-reactivate-confirm`   | `ReactivateConfirmView`, `ReactivateConfirmViewProps`     | Confirmation that continuing reactivates a deactivated account.                                                                                        |
| `./ui/pages/logout`                     | `LogoutView`, `LogoutViewProps`                           | Sign-out confirmation.                                                                                                                                 |
| `./ui/pages/password-recovery-request`  | `RecoveryRequestView`, `RecoveryRequestViewProps`         | "Forgot password" request form.                                                                                                                        |
| `./ui/pages/password-recovery-callback` | `RecoveryCallbackView`, `RecoveryCallbackViewProps`       | Recovery code plus new password form.                                                                                                                  |
| `./ui/pages/totp-enroll`                | `TotpEnrollView`, `TotpEnrollViewProps`                   | Authenticator enrollment: QR code, manual secret, confirmation-code form.                                                                              |
| `./ui/pages/totp-confirm`               | `TotpConfirmView`, `TotpConfirmViewProps`                 | Authenticator enrollment confirmation fallback.                                                                                                        |
| `./ui/pages/phone-enroll`               | `PhoneEnrollView`, `PhoneEnrollViewProps`                 | Phone-number entry that starts phone verification.                                                                                                     |
| `./ui/pages/phone-confirm`              | `PhoneConfirmView`, `PhoneConfirmViewProps`               | SMS code entry that confirms the phone number.                                                                                                         |

### Components

Pieces for composing into your own layout.

| Subpath                                 | Exports                                                                                                               | Component                                                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./ui/components/cookie-consent-modal`  | `CookieConsentModal`, `CookieConsentModalProps`                                                                       | The cookie-consent dialog.                                                                                                                           |
| `./ui/components/password-toggle-field` | `PasswordToggleField` (also `default`), `PasswordToggleFieldProps`                                                    | Comet: a `@zanix/space-ui` `PasswordInput` with a show/hide toggle.                                                                                  |
| `./ui/components/otp-code-field`        | `OtpCodeField` (also `default`), `OtpCodeFieldProps`                                                                  | Comet: six-box one-time/verification code field with paste support.                                                                                  |
| `./ui/components/otp-resend`            | `OtpResend` (also `default`), `OtpResendProps`, `OtpNotifierChannel`                                                  | Comet: "send the code again" button with cooldown countdown (announcement texts through `announcement*` props) and optional delivery-channel picker. |
| `./ui/sdk/countdown-announcements`      | `countdownAnnouncements`, `CountdownAnnouncementProps`                                                                | Resolves the three `Countdown` announcement texts from the catalog for the Comets above.                                                             |
| `./ui/components/rate-limit-countdown`  | `RateLimitCountdown` (also `default`), `RateLimitCountdownProps`                                                      | Comet: countdown ring to a rate-limit expiry that re-enables its form when it reaches zero (announcement texts through `announcement*` props).       |
| `./ui/components/rate-limit-card`       | `RateLimitCard`, `RateLimitCardProps`                                                                                 | Presentational rate-limit notice (heading, body, `RateLimitCountdown`); takes already-resolved strings.                                              |
| `./ui/components/auth-hidden-fields`    | `authHiddenFields`, `AuthHiddenFieldsProps`                                                                           | A function (not a component) returning the hidden `_csrf` and `email`/`phone` inputs to spread into a `<form>`.                                      |
| `./ui/components/login-password-step`   | `LoginPasswordStep` (also `default`), `LoginPasswordStepProps`, `LoginPasswordStepLabels`, `LoginPasswordStepOptions` | The password step of a two-step sign-in; every string is a `labels` prop, every class, id and route an optional `options` field.                     |
| `./ui/components/login-two-step`        | `LoginTwoStep` (also `default`), `LoginTwoStepProps`                                                                  | Headless Comet that swaps the email step for the password step without a reload.                                                                     |

### SDK clients and request/response shapes

Thin REST clients (`@zanix/server`'s `RestClient`), usable from any framework. Every client takes
`IamApiClientOptions` (`{ baseUrl }`).

| Subpath                      | Client and methods                                                                                                                                                        | Also exports                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./ui/sdk/login`             | `LoginClient`: `login`, `oauthAuthorize`, `oauthCallback`, `confirmReactivation`, `refresh`, `logout`, `getOwnAuthMethods`, `getLoginMethods`, `linkOauth`, `unlinkOauth` | `IamApiClientOptions`; bodies `LoginRTO`, `EntryFormRTO`, `EmailFormRTO`, `TokenRTO`, `OAuthQueryRTO`, `OAuthLoginRTO`, `ReactivationConfirmRTO`; results `LoginResult`, `LoginSuccessResult`, `LoginChallengeResult`, `ReactivationChallengeResult`, `ReactivationConfirmResult`, `OauthAuthorizeResult`, `OauthCallbackResult`, `RefreshResult`, `AuthMethodsResult`, `LoginMethodsResult`, `SessionTokens`, `MessageResponse`; `OAUTH_PROVIDERS`, `OauthProvider` |
| `./ui/sdk/otp`               | `OtpClient`: `request`, `verify`                                                                                                                                          | `IamApiClientOptions`, `OtpLoginRTO`, `OtpCallbackResult`, `SecondFactorLoginResult`, `LoginChallengeResult`, `ReactivationChallengeResult`, `SessionTokens`, `MessageResponse`                                                                                                                                                                                                                                                                                      |
| `./ui/sdk/totp`              | `TotpClient`: `verifyLogin`, `enroll`, `confirmEnrollment`, `disable`                                                                                                     | `IamApiClientOptions`, `TotpLoginRTO`, `TotpConfirmRTO`, `TotpEnrollResult`, `SecondFactorLoginResult`, `SessionTokens`, `MessageResponse`                                                                                                                                                                                                                                                                                                                           |
| `./ui/sdk/phone`             | `PhoneClient`: `enroll`, `confirm`, `disable`, `setOtpNotifier`                                                                                                           | `IamApiClientOptions`, `PhoneEnrollRTO`, `PhoneConfirmRTO`, `OtpNotifierRTO`, `MessageResponse`                                                                                                                                                                                                                                                                                                                                                                      |
| `./ui/sdk/password-recovery` | `PasswordClient`: `change`, `addPassword`, `removePassword`, `requestRecovery`, `confirmRecovery`                                                                         | `IamApiClientOptions`, `PwdRTO`, `PwdRecoveryCbRTO`, `PasswordRecoveryResult`, `SessionTokens`, `MessageResponse`                                                                                                                                                                                                                                                                                                                                                    |
| `./ui/sdk/users`             | `UsersClient`: `deactivateOwnAccount` (`PATCH /users/deactivate`), `deleteOwnAccount` (`DELETE /users`)                                                                   | `MessageResponse`                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `./ui/sdk/client-registry`   | `createIamClientRegistry({ baseUrl })`: the clients of one deployment, each behind a get/set/reset seam so a test swaps in a fake                                         | `IamClientRegistry`                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

A login or OAuth2 callback result is narrowed with `'accessToken' in result`; a
`ReactivationChallengeResult` carries a `reactivationToken` for `LoginClient.confirmReactivation`.
`expiresAt` is the access token's remaining lifetime in seconds, not an epoch timestamp.

### Messages, styles and validation

| Subpath               | Exports                                                                                                        | What they are                                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./ui/sdk/messages`   | `IAM_UI_MESSAGES`, `IAM_UI_MESSAGES_EN`, `IAM_UI_MESSAGES_ES`, `IAM_UI_LANGS`, `getIamMessages`, `IamMessages` | The plain-string catalogs `iam` ships (`en`, `es`), by language; `getIamMessages(lang)` returns one or `undefined`, resolving a regional code to its base language. |
|                       | `IAM_UI_MESSAGES_COMPILED`, `getIamCompiledMessages`, `IamCompiledMessages`                                    | The same catalogs compiled to ICU AST (`deno task gen:messages`).                                                                                                   |
|                       | `iamMessages`                                                                                                  | The compiled catalogs as a `@zanix/space` message source for `defineSpaceApp({ messageSources })`.                                                                  |
| `./ui/styles`         | `IAM_UI_CSS`, `iamCssSource`                                                                                   | The default stylesheet of every `data-space` hook `iam` emits, and the same text as a `defineSpaceApp({ cssSources })` source.                                      |
| `./ui/sdk/validation` | `validateEmail`, `validatePassword`, `validateVerificationCode`                                                | Client-side checks that mirror the server rules: `@zanix/validator`'s email predicate, the default `passwordPolicy`, and a six-digit OTP/TOTP code.                 |

### Session guards and error handling

For a `@zanix/space` app that signs in through a separately deployed `iam` instance.

| Subpath                                     | Exports                                                                 | What they are                                                                                                                                                                                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./ui/sdk/session-guard`                    | `iamSessionGuard`, `iamOptionalSessionGuard`, `IamSessionGuardOptions`  | Global guards that resolve the session by calling `iam`'s `POST /login/refresh` through a cached, single-flight, rate-limit-aware lookup; the required variant rejects a missing or failed session, the optional one never gates the request. |
|                                             | `seedIamSessionCache`, `getOrRefreshIamTokens`                          | Seed the cache with the tokens a login just returned; the cache/dedup primitive both guards share.                                                                                                                                            |
| `./ui/sdk/session-helpers`                  | `requireAccessToken`, `requireOwnUserId`, `hasSessionCookie`            | The access token to forward to a service, the caller's user id (`ctx.session.subject`), and a presence-only check for the session cookie.                                                                                                     |
| `./ui/sdk/cookies-accepted-guard`           | `cookiesAcceptedGuard`                                                  | Global guard for an app with no consent banner: marks every request as having accepted cookies so session cookies are delivered.                                                                                                              |
| `./ui/sdk/redirect-unauthorized`            | `redirectIamUnauthorized`, `IamUnauthorizedReason`                      | `onError` handler that turns an `iamSessionGuard` rejection into a redirect to the app's login page, passing the reason (`'no-session'` or `'session-expired'`) to the app's `loginUrl` callback.                                             |
| `./ui/sdk/redirect-session-refresh-failure` | `redirectSessionRefreshFailure`, `RedirectSessionRefreshFailureOptions` | `onError` handler for an upstream refresh failure (a `429` or another fault) that `iamSessionGuard` does not collapse into a `401`.                                                                                                           |
| `./ui/sdk/error-handler`                    | `iamErrorHandler`                                                       | The whole `ssr.onError` chain in its required order: rotated-cookie recovery, the app's own `before` handlers, the unauthorized redirect, the refresh-failure redirect, the stale-CSRF retry, and the app's not-found page for a `404`.       |

### Login-flow helpers

Framework-free helpers for an app that renders `iam`'s views inside its own routes.

| Subpath                   | Exports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `./ui/sdk/login-flow`     | `redirect_to` handling: `REDIRECT_TO_PARAM`, `resolvePostLoginRedirect`, `withRedirectToParam`, `unauthorizedLoginUrl`. Shared error states: `NO_ACCOUNT_ERROR`, `RATE_LIMITED_ERROR`, `UNEXPECTED_ERROR`, `NO_SESSION_ERROR`, `INVALID_CODE_ERROR`, `LoginErrorState`, `readLoginErrorState`. Rate-limit round trip: `RETRY_UNTIL_PARAM`, `buildRateLimitedQuery`, `parseRetryUntil`. Plus `decodeEmailParam` and `redirectResponse` (a redirect whose headers stay mutable, so guard-set cookies survive). |
| `./ui/sdk/otp-channel`    | `OTP_CHANNELS`, `OtpChannel`, `OTP_CHANNEL_PARAM`, `parseOtpChannel`, `resolveOtpChannel`, `withOtpChannelParam`, `deliverableOtpChannels`, `buildOtpNotifierOptions`: which channel a pending code travels on, carried in the URL's `channel` query param.                                                                                                                                                                                                                                                  |
| `./ui/sdk/otp-flow-cache` | `resolveNotifierMethods`, `seedNotifierMethods`, `cooldownEndsAt`, `stampCooldown`, `createOtpFlowCaches`, `NOTIFIER_CACHE_SECONDS`, `DEGRADED_CACHE_SECONDS`, `COOLDOWN_SECONDS`, `NotifierMethods`, `OtpFlowCacheOptions`, `OtpFlowCaches`, `OtpFlowCachesConfig`: the delivery-channel lookup cache and the per-address resend cooldown.                                                                                                                                                                  |

### Page loaders and actions

`./ui/space/login-pages`: the body of each page's `loader` or `action`. The app keeps the page class
(route, decorators, head, layout) and passes in what differs per app (clients, landing page, cache
prefix, paths). A client may be given as a `LazyClient`, a function called only by a branch that
needs it.

| Page                  | Loader                                     | Action and helpers                                                                                                                                  |
| --------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two-step sign-in      | `loginEntryPageData`, `LoginEntryPageData` | `handleLoginEntryAction`, `handleLoginMethodsAction`; `LOGIN_STEP_PARAM`, `LOGIN_PASSWORD_STEP`, `LOGIN_STEP_EMAIL_PARAM`, `INVALID_PASSWORD_ERROR` |
| Password-only sign-in | —                                          | `handlePasswordLoginAction`                                                                                                                         |
| One-time code         | `otpVerifyPageData`, `OtpVerifyPageData`   | `handleOtpVerifyAction`, `handleOtpResendAction`                                                                                                    |
| Authenticator code    | `totpLoginPageData`                        | `handleTotpLoginAction`                                                                                                                             |
| OAuth2 start          | `oauthStartPageData`                       | `handleOauthStartAction`, `buildOauthStateSetCookieHeader`                                                                                          |
| Reactivation          | `reactivatePageData`                       | `handleReactivateAction`, `REACTIVATE_EXPIRED_ERROR`                                                                                                |
| Password recovery     | —                                          | `handleRecoveryRequestAction`                                                                                                                       |
| Sign-out              | —                                          | `handleLogoutAction`, `markSessionRevoked`                                                                                                          |

`LazyClient` is exported from the same subpath.

### See also

- [`Consuming iam`](./consuming-iam.md) — the three integration levels and worked examples.
- [`See more`](./see-more.md) — where each server-side concern is implemented.
- [REST API reference](./rest-api.md) — the endpoints these clients call.
- [Customization](./customization.md) — messages, styles and behaviors.
- [README](../README.md)
