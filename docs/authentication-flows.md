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
- [Email verification](#email-verification)
- [Password recovery and invitations](#password-recovery-and-invitations)
- [Authenticator enrollment](#authenticator-enrollment)
- [Phone verification and code channel](#phone-verification-and-code-channel)
- [Step-up](#step-up)
- [Changing a second factor or a credential](#changing-a-second-factor-or-a-credential)
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
   - `'totp'`: the client posts the authenticator code, or one of the account's backup codes, to
     `POST /api/login/totp/callback`.
   - a notifier (`email`, `sms`, `whatsapp`): `iam` has sent a one-time code on that channel; the
     client posts it to `POST /api/login/otp/callback`.
5. The callback answers session tokens.

Enrolling an authenticator sets `triggerOn` to `login` and `refresh`.

### Passwordless one-time code

1. `GET /api/login/otp/:email` (optional `?notifier=`) sends a code through the requested channel,
   else the account's stored `otpNotifier`, else email. SMS and WhatsApp need a verified phone
   (`400` otherwise).
2. `POST /api/login/otp/callback` with `{ email, code }` answers session tokens. The code of each
   channel is stored under its own target (the account id for email, `<authId>:sms` and
   `<authId>:whatsapp` for the others), so the channel that delivered a verified code is known; see
   [Email verification](#email-verification).
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

### Email verification

An account records `emailVerifiedAt` the first time it proves it controls its mailbox, and never
clears it (`iam` does not change the address of an account). Proofs:

- a verified one-time code delivered by **email**: a passwordless sign-in, a password-recovery code
  and an email step-up code. A code delivered by SMS or WhatsApp proves a phone, not the mailbox;
- an OAuth2 sign-in or link whose provider reports the address as verified. Google's user info
  carries `verified_email`; GitHub's carries no flag, so a GitHub sign-in proves nothing;
- a new account created by self-registration through either of the two paths above, which is created
  already verified.

An account an administrator registered with a password and that has signed in through none of these
stays unverified; nothing is inferred from existing data. The write is idempotent (a later proof
keeps the first timestamp) and never fails the sign-in: a failed write is logged at `warn` and the
next proof records it.

The state reaches consumers in two places:

- `GET /api/login/methods` answers `emailVerified: boolean` and, once proven, `emailVerifiedAt` (an
  ISO 8601 timestamp).
- Every access token carries the OpenID Connect claim `email_verified` (boolean), set when the
  session is issued: password, one-time code, authenticator, OAuth2, session exchange of the hosted
  provider and refresh. A refresh reads the account again, so it reflects a proof recorded since the
  previous token. A token already issued keeps its value until it expires (at most one hour). A
  service that needs the current state calls `GET /api/login/methods` or refreshes.

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
   notice. The answer also carries the account's [backup codes](#backup-codes), shown only there.
3. `DELETE /api/login/totp` removes it, and the backup codes with it.

### Backup codes

An account that loses its authenticator app would be locked out: the sign-in challenge and every
step-up check ask for a code only that app makes. Enabling TOTP therefore issues **10 backup
codes**, each of 10 characters from a 32-character alphabet without look-alikes (`0`, `1`, `I`,
`O`), 50 bits of entropy drawn from the platform CSPRNG, shown as `XXXXX-XXXXX`.

- **Shown once.** `POST /api/login/totp/confirm` answers `{ response, backupCodes }`; so does
  `POST /api/login/totp/backup-codes`. They are never returned again: `GET /api/login/methods` only
  reports `backupCodesRemaining`. The UI must make the person save them before leaving the screen.
- **Stored as digests.** The database holds one `@zanix/helpers` `generateHash` digest per code
  (`medium` level, salted with the account id), never the code. The salt is deterministic per
  account on purpose: a use finds its digest with an equality filter, which makes spending a code a
  single atomic write. The field is `select: false`, so no read or serialization carries it.
- **Accepted instead of an authenticator code**, wherever one is checked: the sign-in challenge
  (`POST /api/login/totp/callback`) and `POST /api/step-up/verify` for an account whose factor is
  TOTP, which mints a token for the same purpose and `bind` as with an authenticator code. Case,
  dashes and spaces are ignored. A 6-digit code is never read as a backup code, so the shape of the
  input decides which factor is checked.
- **Spent once, atomically.** The digest is pulled from the account in the write that finds it
  (`findOneAndUpdate` with `$pull`): of any number of concurrent uses of one code, exactly one
  succeeds.
- **One generic failure.** A wrong or already used backup code answers the same `403` as a wrong
  authenticator code, and counts against the same rate limits (`login:totp-callback`,
  `step-up:verify`), so neither the answer nor the budget tells which kind of code was tried.
- **The owner is told.** Using a code emails the `totp-backup-code-used` notice with how many remain
  (see [Customization](./customization.md#account-security-emails)); at zero it says none are left.
  Like the other notices it is sent only with a database-backed templates mode.
- **Regeneration.** `POST /api/login/totp/backup-codes` (session and a `factor-change` proof bound
  to `totp-backup-codes`) replaces all codes with a new set at once and answers `{ backupCodes }`.
  It answers `409` `TOTP_NOT_ENABLED` for an account without an authenticator app, before the proof
  is spent. An account that enabled TOTP before backup codes existed reports
  `backupCodesRemaining: 0` and gets its first set the same way; nothing is backfilled.
- **Cleared** by `DELETE /api/login/totp` and by the operator reset below; enabling TOTP again
  issues a fresh set.

### Operator reset of an authenticator app

When the person has no backup code left either, support removes the app:
`POST /api/admin/totp/reset` with `{ authId, reason }` (permission `totp-reset`). It clears the
secret, the second-factor setting when it is TOTP, a pending enrollment and every backup code; the
person signs in with their remaining methods and enables the app again, and is emailed the
`totp-reset-by-operator` notice. `reason` is 1 to 200 characters once trimmed and never goes in a
URL. Like every administration operation it needs an account (a service credential is refused), is
checked against the database, is rate limited per operator with the administration mutations, and is
recorded in the [audit trail](./authorization.md#audit-trail) as `totp.reset`. An operator cannot
reset their own account (`403` `TOTP_RESET_SELF`), and an account without an authenticator app
answers `409` `TOTP_NOT_ENABLED`. Sessions already issued stay valid: `@zanix/auth` session tokens
are stateless and are revoked one token at a time, so there is nothing to revoke by account.

#### Reset by a trusted service

When the operators live in another identity directory than the accounts (a staff `iam` next to the
main one), the operator's console cannot call the reset above: its operators are not accounts of the
instance that holds the person. A trusted service does it instead. The service is registered with
its public key (`JWK_PUB_<serviceId>`) and named in `IAM_TOTP_RESET_SERVICES`; it signs an
assertion, exchanges it at `POST /api/admin/service/token` for a short-lived token, finds the
account with `POST /api/admin/service/accounts/lookup` (exact email in the body) and resets it with
`POST /api/admin/service/totp/reset` `{ authId, reason, operator: { id } }`. The effect, the notice
to the owner and the errors are those of the operator reset; the audit event names the service as
`actor` and carries `{ reason, operatorId }`. The service is responsible for checking that its
operator may ask for this before it calls. See
[REST API](./rest-api.md#authenticator-reset-by-a-trusted-service-apiadminservice).

### Phone verification and code channel

Requires a session (hosted `phone/enroll` and `phone/confirm` pages).

1. `POST /api/login/phone/enroll` with `{ phone }` sends an SMS code; nothing is stored. It is
   limited per account (`PHONE_ENROLL_RATELIMIT` per window) and per number
   (`PHONE_ENROLL_NUMBER_COOLDOWN_SECONDS`, for every account), since each request sends a paid SMS
   to a number the caller names.
2. `POST /api/login/phone/confirm` with `{ phone, code }` stores the number when the code verifies,
   limited to `freeRateLimit` attempts per account. The code belongs to the number it was sent to:
   confirming another number fails.
3. `POST /api/login/otp-notifier` with `{ notifier: 'sms' | 'whatsapp' }` makes that channel the
   default for passwordless codes; omitting it returns to email.
4. `DELETE /api/login/phone` forgets the number and the channel preference.

### Step-up

A signed-in user proves a second factor again before a sensitive action (moving a large amount, for
example). Requires a session; `iam` performs no action itself, it signs a token that the service
performing the action checks.

1. `POST /api/step-up/request` with `{ purpose }`. The factor follows the account's own settings and
   the caller cannot choose a weaker one: with TOTP enabled (`totpEnabled` in
   `GET /api/login/methods`) the answer is `{ method: 'totp' }` and nothing is sent; otherwise a
   six-digit code valid 5 minutes goes out through the account's `otpNotifier` (email, `sms` or
   `whatsapp`) and the answer is `{ method: 'otp', channel }`. The code is generated and stored by
   the same OTP machinery as a sign-in code, under a target scoped to the purpose and the account
   (`step-up:<purpose>:<authId>`, with `:sms` or `:whatsapp` appended for those channels), so a
   sign-in code is never a step-up code, a step-up code is never a sign-in code, and a code for one
   purpose is not valid for another. The message says what the code confirms, in the language of the
   request, through the built-in `generic` template of the channel (no stored template is needed).
   `purpose` only selects a wording key, `step-up.purpose.<purpose>`, and its text never reaches the
   message; a purpose with no key takes the neutral `step-up.purpose.default`. A consumer words its
   own purposes with `IAM_MESSAGES` ([Customization](./customization.md#messages)).
2. `POST /api/step-up/verify` with `{ purpose, code, bind? }` checks the code with the factor the
   account's settings require when the request arrives (the authenticator code, or a
   [backup code](#backup-codes), for a TOTP account, the one-time code otherwise) and answers
   `{ stepUpToken, expiresAt }`. A one-time code works once; five wrong guesses burn it. A TOTP code
   is accepted once per account within its window (a replay is a `403`), and two concurrent
   verifications of one code let exactly one through. A TOTP account is limited to `freeRateLimit`
   attempts per window. Every failure answers the same `403`.
3. The service performing the action receives `stepUpToken` and checks it before acting.

The token is a JWT signed RS256 with `iam`'s `JWK_PRI`, the key `api` tokens use; a service verifies
it with the matching public key (`JWK_PUB`). That is also why it cannot pass as an access token: a
`user` access token is checked with `JWT_KEY` and HS256, which an RSA signature cannot satisfy, and
its `typ` and `aud` match no role or permission.

| Claim     | Value                                                                              |
| --------- | ---------------------------------------------------------------------------------- |
| `sub`     | The account id of the session that passed the second factor (never from the body). |
| `typ`     | `'step-up'` (`STEP_UP_TOKEN_TYPE`).                                                |
| `aud`     | `'iam:step-up'` (`STEP_UP_TOKEN_AUDIENCE`).                                        |
| `purpose` | The `purpose` of the request.                                                      |
| `bind`    | The `bind` of the verify request; absent when none was sent.                       |
| `method`  | `'totp'` or `'otp'`: the factor that was verified.                                 |
| `jti`     | A unique id; a service that must accept a token once records it.                   |
| `iss`     | `zanix-auth`.                                                                      |
| `iat`     | Issue time, seconds since the Unix epoch.                                          |
| `exp`     | `iat` plus 5 minutes.                                                              |

A service checks the token with `verifyJWT` from `@zanix/auth` and then the claims `iam` does not
check for it:

```ts
import { verifyJWT } from '@zanix/auth'
import { STEP_UP_TOKEN_AUDIENCE, STEP_UP_TOKEN_TYPE } from '@zanix/iam/shared-enums'

// `publicKey` is iam's JWK_PUB, base64 (the value `@zanix/auth` reads from `JWK_PUB`).
const payload = await verifyJWT(stepUpToken, atob(publicKey), {
  algorithm: 'RS256',
  aud: STEP_UP_TOKEN_AUDIENCE, // signature, expiry, issuer and audience
})
if (
  payload.typ !== STEP_UP_TOKEN_TYPE || // never accept another token signed with the same key
  payload.purpose !== 'wallet-transfer' || // the action being performed
  payload.sub !== session.subject || // the user performing it
  payload.bind !== pendingActionId // the exact action, when a bind was requested
) throw new Error('step-up token does not authorize this action')
// Then record `payload.jti` if the token must be accepted only once.
```

The service must not accept a step-up token through an `api`-type access guard that lists no
permissions: such a guard accepts any token signed with the key, and the claims above are what tell
a step-up token apart.

### Changing a second factor or a credential

An access token alone never changes how the account proves itself. Changing or removing a second
factor, the login-code channel or the password needs a fresh step-up proof with the account's
**current** factor, so a stolen access token (or a script injected into a page) cannot swap the
factor and then pass step-up with its own.

The proof is a step-up token with purpose `factor-change` and a `bind` naming the operation:

| Operation                           | `bind`              |
| ----------------------------------- | ------------------- |
| `POST /api/login/totp/confirm`      | `totp-confirm`      |
| `DELETE /api/login/totp`            | `totp-disable`      |
| `POST /api/login/phone/confirm`     | `phone-confirm`     |
| `DELETE /api/login/phone`           | `phone-disable`     |
| `POST /api/login/otp-notifier`      | `otp-notifier`      |
| `POST /api/pwd/change`              | `password-change`   |
| `POST /api/pwd/add`                 | `password-add`      |
| `DELETE /api/pwd/remove`            | `password-remove`   |
| `POST /api/login/totp/backup-codes` | `totp-backup-codes` |

1. `POST /api/step-up/request` with `{ purpose: 'factor-change' }`, then `POST /api/step-up/verify`
   with `{ purpose: 'factor-change', code, bind: '<operation>' }`, exactly as above. The factor is
   the account's current one: its authenticator app when TOTP is enabled, otherwise a code through
   its `otpNotifier` (email by default).
2. Send the answer's `stepUpToken` in the **`X-Znx-Step-Up-Token`** header of the operation.
3. `iam` verifies it with its own public key (`JWK_PUB`, or the rotated `JWK_PUB_V<n>` the `kid`
   names): signature, expiry, `typ`, `aud`, purpose `factor-change`, `sub` equal to the session
   account and `bind` equal to the operation. Then it records the `jti` in the `step_up_claim`
   collection (unique index, removed by a TTL index after the token expires), so the token works
   once, also under concurrent requests. A mistyped confirmation code costs no proof: the token is
   spent after the rest of the input checked out, before anything is written.

A request with no token answers `403` `FACTOR_CHANGE_PROOF_REQUIRED`, with `meta.stepUp`
`{ purpose, bind }` naming what to confirm; any token that does not prove the operation (another
purpose, account or operation, expired, forged, already used) answers `403`
`FACTOR_CHANGE_PROOF_INVALID`.

**First enrollment.** An account with no verified factor needs no special case: its current factor
is the email code, so the same two calls prove control of the mailbox (and record it, see
`emailVerifiedAt`). An account with only an unverified email cannot enroll silently either: it
passes the email code through the same step-up.

**Authenticator enrollment.** `GET /api/login/totp/enroll` keeps the issued secret as the account's
pending secret for 10 minutes (`pendingTotpSecret`, encrypted, with `pendingTotpExpiresAt`) and
returns it once. `POST /api/login/totp/confirm` verifies `code` against that pending secret and
stores it; a `secret` in the body is optional, never used, and refused when it is not the pending
one. Without a pending enrollment (or after it expired) the answer is `400`.

The hosted `totp/enroll` and `phone/enroll` pages deliver the code and the `totp/confirm` and
`phone/confirm` forms take it in a `stepUpCode` field, which the page turns into the proof.

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
  is sent in `X-Znx-App-Token`; phone confirmation and step-up per account. Tiers and keys are in
  the [REST API reference](./rest-api.md#conventions).
- **Step-up.** The factor is read from the account at each call, never from the request, and the
  account is the session's. A TOTP code is accepted once per account within its tolerance window
  (`totpToleranceSteps`), at sign-in, step-up and enrollment alike, so entering the code that just
  signed you in as a step-up code is refused until the next code; a one-time code is claimed
  atomically. A service that must accept an authorization once records the token's `jti`; `iam` does
  that itself for the `factor-change` proofs it checks. The step-up code message is worded from the
  `step-up.*` catalog and never contains text taken from the request.
- **Second-factor replacement.** See
  [Changing a second factor or a credential](#changing-a-second-factor-or-a-credential): an access
  token alone cannot enroll, replace or remove a factor, change the login-code channel or the
  password.
- **Open redirects.** `redirect_to` is followed only for a same-origin relative path or an origin
  listed in `TRUSTED_REDIRECT_ORIGINS`. A path must start with a single `/`, hold no backslash or
  control character (browsers read `/\evil.test` and `/<tab>/evil.test` as `//evil.test`) and
  resolve to the same origin.
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
