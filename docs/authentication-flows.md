## Authentication flows

Each sign-in and account flow end to end. Endpoint details (bodies, statuses, rate-limit keys) are
in the [REST API reference](./rest-api.md); this page describes the sequence and the security
properties. The hosted pages under `/{lang}/...` run the same interactors in process
(`@Page({ Interactor: AuthService })`); an app rendering `iam`'s views itself drives them through
the REST API with the helpers in
[`ui/space/login-pages`](./api-reference.md#page-loaders-and-actions).

Constants used below: one-time codes are six digits and valid 5 minutes; a reactivation token is
valid 5 minutes; a hosted-provider authorization code is valid 60 seconds and single use.

### Contents

- [Password sign-in and second factor](#password-sign-in-and-second-factor)
- [Passwordless one-time code](#passwordless-one-time-code)
- [Two-step sign-in](#two-step-sign-in)
- [OAuth2 sign-in](#oauth2-sign-in)
- [Self-registration](#self-registration)
- [Sessions and refresh rotation](#sessions-and-refresh-rotation)
- [Password recovery and invitations](#password-recovery-and-invitations)
- [Authenticator enrollment](#authenticator-enrollment)
- [Phone verification and code channel](#phone-verification-and-code-channel)
- [Deactivation, reactivation and deletion](#deactivation-reactivation-and-deletion)
- [Hosted OAuth2 provider](#hosted-oauth2-provider)
- [Security properties](#security-properties)
- [See also](#see-also)

### Password sign-in and second factor

1. `POST /api/login/login` with `{ email, password }` (captcha when configured).
2. `iam` verifies the password. An unknown email and a wrong password answer the same `403`. A
   deactivated or deleted profile answers `403` after the password is verified.
3. With no second factor configured for sign-in, it answers session tokens plus `mustChangePassword`
   (set for an account an administrator registered with a password).
4. With a second factor (`twoFactorAuthConfig.triggerOn` includes `login`): `iam` answers a
   challenge, `{ message, email, method }`, and the client branches on `method`:
   - `'totp'`: the client posts the authenticator code to `POST /api/login/totp/callback`.
   - a notifier (`email`, `sms`, `whatsapp`): `iam` has sent a one-time code on that channel; the
     client posts it to `POST /api/login/otp/callback`.
5. The callback answers session tokens.

Enrolling an authenticator sets `triggerOn` to `login` and `refresh`.

### Passwordless one-time code

1. `GET /api/login/otp/:email` (optional `?notifier=`) sends a code through the requested channel,
   else the account's stored `otpNotifier`, else email. SMS and WhatsApp need a verified phone
   (`400` otherwise).
2. `POST /api/login/otp/callback` with `{ email, code }` answers session tokens.
3. If the account's second-factor method differs from the channel that delivered the code, the
   callback answers a second-factor challenge instead (an authenticator prompt, or a code on the
   other channel).

For an unknown email, see [Self-registration](#self-registration).

### Two-step sign-in

For an app that renders `LoginEntryView` with `handleLoginEntryAction`
([`ui/space/login-pages`](../ui/space/login-pages.ts)); the hosted `/{lang}/login` page is a
single-step password form.

1. The visitor submits an email. The `LoginTwoStep` Comet may call the app's methods endpoint
   (`handleLoginMethodsAction`) to reveal the password field without a reload.
2. The action calls `GET /api/login/methods/:email`. An account with a password goes to the password
   step (`?step=password&email=...` on the same page).
3. Any other email gets a one-time code (`GET /api/login/otp/:email`) and goes to the code page.
   With `registration: 'closed'`, an unknown email also goes to the code page and no code arrives,
   so the page never reveals which emails exist; with `'open'` it reports "no account" when
   self-registration refuses the email.
4. The password step posts `POST /api/login/login`; a second-factor challenge redirects to the
   authenticator page (`method: 'totp'`) or the code page (a notifier).
5. `seedNotifierMethods` stores the channels from step 2 so the code page does not repeat the
   rate-limited lookup, which is why `LOGIN_METHODS_RATELIMIT` defaults to `2`.

### OAuth2 sign-in

Google and GitHub, each enabled by its env vars
([Configuration](./configuration.md#oauth2-providers)).

1. `GET /api/login/:oauth` (optional `?email=` login hint) answers the provider's authorization URL
   and `state`. The hosted `/{lang}/login/[oauth]` page issues the `state` cookie
   (`oauthStateIssueGuard`); an app does it with `buildOauthStateSetCookieHeader`.
2. The provider redirects back with `code` and `state`. The hosted callback page rejects a missing
   or mismatched `state` (`oauthStateVerifyGuard`).
3. `POST /api/login/:oauth/callback` with `{ code }` exchanges it with the provider (authorization
   code flow). The provider must report a verified email (`403` otherwise).
4. For an existing account whose `oauthProvider` is this provider: the same result as a password
   sign-in, including a second-factor challenge, which the hosted callback page sends on to the
   authenticator or code page for the challenge's `email`. An existing account with no provider or a
   different one answers `409`: OAuth2 never attaches itself to an existing account at sign-in.
5. A signed-in user connects a provider with `POST /api/login/:oauth/link` (the provider's email
   must equal the account's, `409` otherwise) and disconnects it with `DELETE /api/login/:oauth`.

### Self-registration

An unknown email may create its own account through either path, each gated by a config whose
default comes from `SELF_REGISTRATION` ([Configuration](./configuration.md#runtime-configs)):

- **One-time code** (`selfRegistrationViaOTP`): `GET /api/login/otp/:email` sends a code to the
  email (email channel only) without creating anything. `POST /api/login/otp/callback` with a valid
  code creates the profile and sign-in record, sends a `welcome` email, and answers session tokens.
  Closed, the dispatch answers `403`.
- **OAuth2** (`selfRegistrationViaOAuth`): the first callback for an unknown verified email creates
  the account (with `oauthProvider` set) and sends a `welcome` email. Closed, it answers `403`.

A new account receives the `defaultRoleId` role (`DEFAULT_ROLE_ID`) as its first role; unset, it has
no permissions. A password-recovery request for an unknown email never creates an account.

### Sessions and refresh rotation

Tokens come from `@zanix/auth`: a signed access token (at most one hour) and a refresh token
(`ACCESS_TOKEN_EXPIRATION`, `REFRESH_TOKEN_EXPIRATION`). The hosted pages and `applySessionTokens`
store them as cookies; REST clients receive them in the body.

1. `POST /api/login/refresh` with the refresh token (body, or the session cookie).
2. `@zanix/auth` rotates the pair and detects reuse of a rotated token (with Redis across replicas).
3. `iam` re-resolves the permissions of all the account's roles, so a role change applies from this
   refresh on, and refuses a deactivated or deleted profile (`403`).
4. `POST /api/login/logout` revokes a refresh token.

The endpoint runs on `criticalRateLimit`. A backend refreshing for many users should pass each
user's token so the limit is keyed per user; see
[Consuming iam](./consuming-iam.md#rate-limiting--read-this-if-you-proxy-refresh-through-your-own-backend).
A `@zanix/space` app delegating to `iam` uses `iamSessionGuard`, which caches refresh results.

### Password recovery and invitations

1. `GET /api/pwd/recovery/:email` (captcha when configured) sends a recovery code through the
   account's stored channel. The response is the same for every email: nothing is sent for an
   unknown, deactivated or deleted account.
2. `POST /api/pwd/recovery/callback` with `{ email, code, password }` applies the `passwordPolicy`
   behavior (`400` before the code is consumed), stores the new password, clears
   `mustChangePassword` and answers session tokens. The hosted page shows a rejected password as a
   `weakPassword` banner.

An administrator registering an account with `POST /api/users/register` either sets a password (the
user must change it on first sign-in, `mustChangePassword`) or omits it, in which case `iam` sends a
recovery code right away and the user chooses their own password through step 2.

A signed-in user changes the password with `POST /api/pwd/change` (current password required), adds
a first one with `POST /api/pwd/add`, and removes it with `DELETE /api/pwd/remove`. Change, add and
recovery apply the `passwordPolicy` behavior.

### Authenticator enrollment

Requires a session (the hosted `totp/enroll` and `totp/confirm` pages use `pageSessionGuard`).

1. `GET /api/login/totp/enroll` answers `{ secret, uri }`; the page renders the QR code. Nothing is
   stored.
2. `POST /api/login/totp/confirm` with `{ secret, code }` stores the secret only when the code
   verifies, makes TOTP the second factor on sign-in and refresh, and emails a `totp-enabled`
   notice.
3. `DELETE /api/login/totp` removes it.

### Phone verification and code channel

Requires a session (hosted `phone/enroll` and `phone/confirm` pages).

1. `POST /api/login/phone/enroll` with `{ phone }` sends an SMS code; nothing is stored.
2. `POST /api/login/phone/confirm` with `{ phone, code }` stores the number when the code verifies,
   limited to `freeRateLimit` attempts per account.
3. `POST /api/login/otp-notifier` with `{ notifier: 'sms' | 'whatsapp' }` makes that channel the
   default for passwordless codes; omitting it returns to email.
4. `DELETE /api/login/phone` forgets the number and the channel preference.

### Deactivation, reactivation and deletion

1. `PATCH /api/users/deactivate` sets the caller's profile `INACTIVE`; `DELETE /api/users` sets it
   `DELETED`. An administrator can do either with `PATCH /api/users/:id` (`status`).
2. From then on, password and authenticator sign-in, refresh and the recovery callback answer `403`,
   and a recovery request sends nothing. The access token already issued stays valid until it
   expires.
3. An `INACTIVE` account can still request a one-time sign-in code. A verified code, or an OAuth2
   sign-in, answers `{ needsReactivationConfirm: true, reactivationToken }` instead of a session.
4. The hosted `login/reactivate/[token]` page (or `handleReactivateAction`) asks the visitor to
   confirm, then `POST /api/login/reactivate` sets the profile `ACTIVE` and finishes the sign-in.
5. A `DELETED` account never comes back through any sign-in.

### Hosted OAuth2 provider

`iam` acting as the authorization server for another host, so its visitors sign in on `iam`'s pages.
Clients are registered by the operator in `OAUTH_PROVIDER_CLIENTS`
([Configuration](./configuration.md#hosted-oauth2-provider-clients)); there is no self-service
registration.

1. The host redirects the browser to
   `GET /api/oauth/authorize?client_id=...&redirect_uri=...&response_type=code&state=...`.
2. `iam` rejects an unknown `client_id` (`400`) or a `redirect_uri` not registered byte for byte for
   that client (`403`) before any redirect.
3. Without an `iam` session cookie, `iam` redirects to `/en/login?redirect_to=<this authorize URL>`,
   and the visitor comes back to step 1 after signing in.
4. With a session, `iam` issues a code bound to the subject, the client and the redirect URI, and
   redirects to `redirect_uri?code=...&state=...`. `state` is relayed unvalidated; the host checks
   it (RFC 6749).
5. The host's backend calls `POST /api/oauth/token` with `grant_type=authorization_code`, the code,
   `client_id`, `client_secret` (compared in constant time) and the same `redirect_uri`. Every code
   failure (expired, reused, other client) answers the same `403`.
6. The response is `{ accessToken, refreshToken, expiresAt }`, the same shape as every other
   sign-in.

No consent screen is shown: a signed-in browser sent to `authorize` by a registered client is
redirected with a code immediately. This is acceptable only while clients are operator-curated.

### Security properties

- **Account enumeration.** Password sign-in answers the same `403` for an unknown email and a wrong
  password. `GET /api/login/methods/:email` answers an unknown email exactly like an account with no
  password, provider or phone, and has its own rate limit. The two-step sign-in with
  `registration: 'closed'` treats an unknown email like any other, and
  `GET /api/pwd/recovery/:email` answers every email the same way. Not covered:
  `GET /api/login/otp/:email` answers `403` for an unknown email while self-registration is closed.
- **Auto-linking.** A verified one-time code signs into whichever account holds that email, however
  it was created (password, OAuth2 or code). This is safe while every flow that adds a sign-in
  method confirms control of the inbox. OAuth2 sign-in does not link: an email owned by an account
  with another provider, or none, answers `409`.
- **Rate limits.** Every anonymous endpoint has its own bucket per client IP, taken from proxy
  headers: deploy behind a trusted reverse proxy. Refresh is keyed per token subject when the token
  is sent in `X-Znx-App-Token`; phone confirmation per account. Tiers and keys are in the
  [REST API reference](./rest-api.md#conventions).
- **Open redirects.** `redirect_to` is followed only for a same-origin relative path or an origin
  listed in `TRUSTED_REDIRECT_ORIGINS`.
- **CSRF.** Every hosted form page runs `csrfGuard()`; OAuth2 sign-in checks `state` through a
  cookie.
- **Cookie consent.** `@zanix/auth` delivers session cookies only for a request marked as having
  accepted cookies. The hosted pages record the decision through the consent dialog in the `[lang]`
  layout (and the `consent` page as its no-JavaScript fallback); declining keeps the app usable but
  no session cookie is set. `COOKIE_CONSENT_ENABLED=false` removes the dialog and marks every
  request as accepted, for deployments that obtain consent elsewhere. An app with no banner
  registers `cookiesAcceptedGuard`.

### See also

- [REST API reference](./rest-api.md)
- [Authorization](./authorization.md)
- [Consuming iam](./consuming-iam.md)
- [Configuration](./configuration.md)
- [README](../README.md)
