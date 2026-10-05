## REST API reference

Every REST endpoint `iam` serves, per controller. All paths carry the REST prefix `/api` (the
`@zanix/server` default; `mod.ts` moves only the frontend app's own prefix to `iam-space`). The
hosted pages under `/{lang}/...` are not REST endpoints; they call the same interactors in process
(see [Authentication flows](./authentication-flows.md)).

A route decorated without a path takes its handler method's name as the last segment, which is why
password login is `POST /api/login/login`, logout `POST /api/login/logout` and password change
`POST /api/pwd/change`.

For typed clients over these endpoints, see the
[API reference](./api-reference.md#sdk-clients-and-requestresponse-shapes).

### Contents

- [Conventions](#conventions)
- [Login and sessions (`/api/login`)](#login-and-sessions-apilogin)
- [One-time codes (`/api/login/otp`)](#one-time-codes-apiloginotp)
- [Authenticator app (`/api/login/totp`)](#authenticator-app-apilogintotp)
- [OAuth2 sign-in (`/api/login/:oauth`)](#oauth2-sign-in-apiloginoauth)
- [Phone and login-code channel (`/api/login/phone`)](#phone-and-login-code-channel-apiloginphone)
- [Passwords (`/api/pwd`)](#passwords-apipwd)
- [Users (`/api/users`)](#users-apiusers)
- [Roles (`/api/roles`)](#roles-apiroles)
- [Audit trail (`/api/audit`)](#audit-trail-apiaudit)
- [Permissions (`/api/permissions`)](#permissions-apipermissions)
- [Grant Access (`/api/grant-access`)](#grant-access-apigrant-access)
- [Notification templates (`/api/templates`)](#notification-templates-apitemplates)
- [Hosted OAuth2 provider (`/api/oauth`)](#hosted-oauth2-provider-apioauth)
- [Well-known discovery](#well-known-discovery)
- [See also](#see-also)

### Conventions

**Authentication.** "Session" means `@AuthTokenValidation()` (`@zanix/auth`): the request carries a
valid `user` access token (`Authorization: Bearer <accessToken>`). A missing or invalid token
answers `401`. A route that also lists permissions answers `403` unless the token's `aud` holds at
least one of them (OR semantics; the wildcard `*` satisfies every check). Permission codes are
`<SERVICE_ID>:<name>`, see [Authorization](./authorization.md#permission-catalog-rbac_permissions).

**Rate limits.** Anonymous routes run `@RateLimitGuard` with `trustProxyHeader: true`: the bucket
key is the client IP taken from proxy-forwarded headers, so it is only correct behind a trusted
reverse proxy. Each route has its own `app` key, so one route's calls never spend another's budget.
The limit is requests per `RATE_LIMIT_WINDOW_SECONDS` (default 60, `@zanix/auth`). Tiers:

| Constant                | Env var                   | Default |
| ----------------------- | ------------------------- | ------- |
| `freeRateLimit`         | `FREE_RATELIMIT`          | `3`     |
| `criticalRateLimit`     | `CRITICAL_RATELIMIT`      | `1`     |
| `loginMethodsRateLimit` | `LOGIN_METHODS_RATELIMIT` | `2`     |

An exceeded limit answers `429` with `Retry-After` and the `X-Znx-RateLimit-*` headers. The
administration mutations (roles, permissions, `PATCH /api/users/:id`) can also answer `429` from
their own per-operator bucket (`iam:admin-mutations`, `ADMIN_MUTATION_RATELIMIT`), on top of the
session's; see [Authorization](./authorization.md#rate-limit).

**Captcha.** `@CaptchaGuard()` is active only when a captcha provider is configured (see
[Configuration](./configuration.md#captcha)). It then requires the `X-Znx-Captcha-Token` header:
missing answers `400`, a failed verification `403`.

**Errors.** Request validation (the RTOs listed per route) answers `400`. Every error body is the
`@zanix/errors` `HttpError` shape.

**Session tokens.** A successful sign-in answers `{ accessToken, refreshToken, expiresAt }`, where
`expiresAt` is the access token's remaining lifetime in seconds (the configured lifetime minus 10
seconds). A primary-credential sign-in adds `mustChangePassword`.

**Message responses.** Most mutations answer `{ response: string }`, e.g.
`{ "response": "notification sent" }`.

### Login and sessions (`/api/login`)

`LoginController` ([`login.handler.ts`](../src/server/handlers/login.handler.ts)), backed by
`AuthService`.

| Method and path                 | Auth    | Rate limit (`app`, tier)                 | Request                             |
| ------------------------------- | ------- | ---------------------------------------- | ----------------------------------- |
| `POST /api/login/login`         | None    | `login:password`, `freeRateLimit`        | Body `{ email, password }`; captcha |
| `POST /api/login/refresh`       | None    | `login:refresh`, `criticalRateLimit`     | Body `{ token? }`                   |
| `POST /api/login/logout`        | Session | —                                        | Body `{ token? }`                   |
| `POST /api/login/reactivate`    | None    | `login:reactivate`, `freeRateLimit`      | Body `{ reactivationToken }`        |
| `GET /api/login/methods`        | Session | —                                        | —                                   |
| `GET /api/login/methods/:email` | None    | `login:methods`, `loginMethodsRateLimit` | Param `email`                       |

- **`POST /api/login/login`** answers session tokens plus `mustChangePassword`, or, when the account
  has a second factor that triggers on login, a challenge, `{ message, email, method }`: `method` is
  `'totp'` for an authenticator code, or the notifier a one-time code was just sent through. `403`
  for an unknown email or a wrong password (the same message for both), or a deactivated/deleted
  profile.
- **`POST /api/login/refresh`** exchanges a refresh token (the body `token`, or the session cookie
  when omitted) for a new pair and re-resolves the account's permissions. `403` for an expired,
  invalid or revoked token or an inactive profile. When the token also arrives in the
  `X-Znx-App-Token` header or cookie, `refreshRateLimitIdentityGuard` keys the limit by the token's
  subject instead of the IP, so a backend refreshing for many users does not share one bucket.
- **`POST /api/login/logout`** revokes the given refresh token: `{ response: 'token revoked' }`.
- **`POST /api/login/reactivate`** exchanges the `reactivationToken` from a sign-in on a deactivated
  account (valid 5 minutes) for a finished sign-in, reactivating the profile. Answers what
  `POST /api/login/login` answers. `403` for an invalid or expired token or a deleted account.
- **`GET /api/login/methods`** answers the caller's own methods:
  `{ email, hasPassword, oauthProvider, totpEnabled, phone, otpNotifier }`, with `phone` masked to
  its last four digits. `401` without a session subject, `403` if the account no longer exists.
- **`GET /api/login/methods/:email`** answers
  `{ hasPassword, oauthProviders, otpNotifier, hasVerifiedPhone }`. The answer for an unknown email
  is identical to that of an account with no password, no OAuth2 provider and no phone, so it does
  not reveal whether an account exists.

### One-time codes (`/api/login/otp`)

| Method and path                | Auth | Rate limit (`app`, tier)              | Request                          |
| ------------------------------ | ---- | ------------------------------------- | -------------------------------- |
| `GET /api/login/otp/:email`    | None | `login:otp`, `criticalRateLimit`      | Param `email`; query `notifier?` |
| `POST /api/login/otp/callback` | None | `login:otp-callback`, `freeRateLimit` | Body `{ email, code }`           |

- **`GET /api/login/otp/:email`** sends a six-digit code valid 5 minutes and answers
  `{ response: 'notification sent' }`. `notifier` (`email`, `sms` or `whatsapp`) overrides the
  account's stored channel for this one dispatch. For an unknown email the code is sent only when
  self-registration by OTP is open and the channel is `email`; otherwise `403`. `400` when an SMS or
  WhatsApp channel is requested for an account with no verified phone.
- **`POST /api/login/otp/callback`** verifies the code. It answers session tokens; or, for an
  unknown email with self-registration open, creates the account and answers session tokens; or
  `{ needsReactivationConfirm: true, reactivationToken }` for a deactivated account; or a
  second-factor challenge when the account's second-factor method differs from the channel the code
  used. `403` for a wrong or expired code or a deleted account.

### Authenticator app (`/api/login/totp`)

| Method and path                 | Auth    | Rate limit (`app`, tier)               | Request                 |
| ------------------------------- | ------- | -------------------------------------- | ----------------------- |
| `POST /api/login/totp/callback` | None    | `login:totp-callback`, `freeRateLimit` | Body `{ email, code }`  |
| `GET /api/login/totp/enroll`    | Session | —                                      | —                       |
| `POST /api/login/totp/confirm`  | Session | —                                      | Body `{ secret, code }` |
| `DELETE /api/login/totp`        | Session | —                                      | —                       |

- **`POST /api/login/totp/callback`** answers session tokens. `403` when the account has no TOTP
  secret, the code is wrong, or the profile is inactive. Codes are accepted within
  `totpToleranceSteps` 30-second steps of the current one (default 1).
- **`GET /api/login/totp/enroll`** answers `{ secret, uri }` (an `otpauth://` provisioning URI whose
  issuer is `SERVICE_ID`). Nothing is stored yet.
- **`POST /api/login/totp/confirm`** verifies `code` against `secret`, stores the secret, makes TOTP
  the account's second factor on login and refresh, emails a `totp-enabled` notice, and answers
  `{ response: 'TOTP enabled' }`. `403` for a wrong code.
- **`DELETE /api/login/totp`** removes the secret and the second-factor setting when TOTP is the
  configured method: `{ response: 'TOTP disabled' }`.

### OAuth2 sign-in (`/api/login/:oauth`)

`:oauth` is `google` or `github`; a provider without its env vars answers `400`.

| Method and path                   | Auth    | Rate limit (`app`, tier)                | Request                     |
| --------------------------------- | ------- | --------------------------------------- | --------------------------- |
| `GET /api/login/:oauth`           | None    | `login:oauth`, `criticalRateLimit`      | Query `email?` (login hint) |
| `POST /api/login/:oauth/callback` | None    | `login:oauth-callback`, `freeRateLimit` | Body `{ code }`             |
| `POST /api/login/:oauth/link`     | Session | —                                       | Body `{ code }`             |
| `DELETE /api/login/:oauth`        | Session | —                                       | —                           |

- **`GET /api/login/:oauth`** answers the provider's authorization URL and its `state`
  (`OauthAuthorizeResult`). Persist `state` to check it on the callback.
- **`POST /api/login/:oauth/callback`** exchanges the provider's authorization `code`. It answers
  what `POST /api/login/login` answers, creates the account on a first sign-in when OAuth2
  self-registration is open, or answers a reactivation challenge for a deactivated account. `403`
  when the provider reports no verified email, self-registration is closed for an unknown email, or
  the account is deleted. `409` when the email already has an account whose `oauthProvider` differs
  from this provider (including an account with none).
- **`POST /api/login/:oauth/link`** connects the provider to the caller's own account. `409` when
  the provider account's email differs from the caller's; `403` when it has no verified email.
- **`DELETE /api/login/:oauth`** disconnects the provider if it is the connected one.

### Phone and login-code channel (`/api/login/phone`)

| Method and path                 | Auth    | Rate limit (`app`, tier)                     | Request                |
| ------------------------------- | ------- | -------------------------------------------- | ---------------------- |
| `POST /api/login/phone/enroll`  | Session | —                                            | Body `{ phone }`       |
| `POST /api/login/phone/confirm` | Session | `phone:confirm`, `freeRateLimit` per account | Body `{ phone, code }` |
| `DELETE /api/login/phone`       | Session | —                                            | —                      |
| `POST /api/login/otp-notifier`  | Session | —                                            | Body `{ notifier? }`   |

- `phone` is E.164-shaped (`+` optional, spaces, parentheses and hyphens are stripped before the
  check).
- **`POST /api/login/phone/enroll`** sends an SMS code valid 5 minutes; the number is not stored
  yet.
- **`POST /api/login/phone/confirm`** stores the number when the code matches (`403` otherwise). The
  `phoneConfirmRateLimitIdentityGuard` applies the `freeRateLimit` ceiling to the authenticated
  caller, which the token's own account-wide limit would otherwise replace.
- **`DELETE /api/login/phone`** forgets the phone and any `sms`/`whatsapp` channel preference.
- **`POST /api/login/otp-notifier`** sets the channel for passwordless login codes: `sms` or
  `whatsapp`; omitted or `''` resets to email. `400` when choosing `sms`/`whatsapp` without a
  verified phone.

### Passwords (`/api/pwd`)

`PasswordController` ([`password.handler.ts`](../src/server/handlers/password.handler.ts)), backed
by `PasswordService`.

| Method and path                   | Auth    | Rate limit (`app`, tier)                 | Request                                 |
| --------------------------------- | ------- | ---------------------------------------- | --------------------------------------- |
| `POST /api/pwd/change`            | Session | —                                        | Body `{ currentPassword, newPassword }` |
| `POST /api/pwd/add`               | Session | —                                        | Body `{ newPassword }`                  |
| `DELETE /api/pwd/remove`          | Session | —                                        | —                                       |
| `GET /api/pwd/recovery/:email`    | None    | `pwd:recovery`, `criticalRateLimit`      | Param `email`; captcha                  |
| `POST /api/pwd/recovery/callback` | None    | `pwd:recovery-callback`, `freeRateLimit` | Body `{ email, code, password }`        |

- **`change`** verifies `currentPassword` (`403`), applies the `passwordPolicy` behavior (`400`),
  clears `mustChangePassword` and emails a `password-changed` notice.
- **`add`** sets a first password: `409` when one already exists, `400` on a policy failure.
- **`remove`** deletes the password. Email one-time codes keep working, so this cannot lock an
  account out.
- **`recovery/:email`** sends a recovery code to the account's stored channel and answers
  `{ response: 'notification sent' }` for every email; nothing is sent for an unknown, deactivated
  or deleted account.
- **`recovery/callback`** applies the `passwordPolicy` behavior to `password` (`400`, before the
  code is consumed), verifies the code, stores `password`, clears `mustChangePassword` and answers
  session tokens. `403` for an unknown email, a wrong code or an inactive profile.

### Users (`/api/users`)

`UsersController` ([`users.handler.ts`](../src/server/handlers/users.handler.ts)), backed by
`UsersService`. Self-scoped routes act only on the session's own account.

| Method and path               | Auth and permission         | Request                                                          |
| ----------------------------- | --------------------------- | ---------------------------------------------------------------- |
| `POST /api/users/register`    | `user-write`                | Body `{ email, password?, firstName?, lastName?, phoneNumber? }` |
| `GET /api/users`              | Session                     | —                                                                |
| `PATCH /api/users`            | Session                     | Body `{ firstName?, lastName?, phoneNumber? }`                   |
| `PATCH /api/users/deactivate` | Session                     | —                                                                |
| `DELETE /api/users`           | Session                     | —                                                                |
| `GET /api/users/search`       | `user-read` or `user-write` | Query `query?`, `status?`, `page` (1), `limit` (10)              |
| `GET /api/users/:id`          | `user-read` or `user-write` | Param `id` (ObjectId)                                            |
| `PATCH /api/users/:id`        | `user-write`                | Body `{ firstName?, lastName?, phoneNumber?, status? }`          |

- **`register`** creates the profile and its sign-in record and emails a `welcome` notice. With a
  `password`, the account must change it on first sign-in; without one, a recovery code is sent so
  the user sets their own. `409` when the email is registered.
- **`GET /api/users`** answers the caller's profile; **`PATCH /api/users`** updates it (never
  `status`). `404` when the account has no linked profile.
- **`deactivate`** sets the profile `INACTIVE`; **`DELETE /api/users`** sets it `DELETED`. The
  current access token stays valid until it expires; every later refresh or sign-in is refused,
  except the reactivation path for `INACTIVE`.
- **`PATCH /api/users/:id`** accepts `status` `INACTIVE` or `DELETED` only; no edit sets `ACTIVE`.
  `404` for an unknown id.

### Roles (`/api/roles`)

| Method and path                               | Permission                  | Request                                                                                                 |
| --------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `POST /api/roles`                             | `role-write`                | Body `{ name, code, description, tenantId?, permissions: ObjectId[], isSystem? }` (see below)           |
| `GET /api/roles`                              | `role-read` or `role-write` | Query `query?`, `tenantId?`, `page`, `limit`                                                            |
| `GET /api/roles/:id`                          | `role-read` or `role-write` | Param `id`; the role with `permissions` populated, its `updatedAt` and `holderCount`                    |
| `GET /api/roles/:id/holders`                  | `role-read` or `role-write` | Param `id`, query `page`, `limit`; `{ docs: [{ authId, userId, firstName, lastName, status }], total }` |
| `PATCH /api/roles/:id`                        | `role-write`                | Body `{ name?, description?, permissions?, updatedAt? }`                                                |
| `DELETE /api/roles/:id`                       | `role-write`                | Param `id`; refused while accounts hold the role                                                        |
| `POST /api/roles/assign`                      | `role-write`                | Body `{ authId, roleId }`; replaces every role of the account                                           |
| `POST /api/roles/add`                         | `role-write`                | Body `{ authId, roleIds: ObjectId[] }`; keeps the roles it holds                                        |
| `POST /api/roles/remove`                      | `role-write`                | Body `{ authId, roleIds: ObjectId[] }`; ignores roles it does not hold                                  |
| `GET /api/roles/accounts/:authId`             | `role-read` or `role-write` | Param `authId`; answers `{ authId, roleIds }`                                                           |
| `GET /api/roles/accounts/:authId/permissions` | `role-read` or `role-write` | Param `authId`; `{ authId, roleIds, permissions: [{ code, roles: [roleId] }] }`                         |
| `PUT /api/roles/accounts/:authId`             | `role-write`                | Body `{ roleIds: ObjectId[] }`; the exact list, empty clears it                                         |

`name` is 2 to 80 characters, `code` 2 to 64 of lowercase letters and digits joined by `-`, `_`, `.`
or `:`, `description` 1 to 500; none may hold control, bidirectional or zero-width characters or
start or end with a space. `permissions` takes at most 200 ids, and a repeated id is stored once.
`isSystem` marks a system role and only a holder of `*` may send it. `PATCH` and `DELETE` of a
system role answer `403`.

`GET /api/roles/accounts/:authId/permissions` is what the account can do today, resolved with the
same `resolveEffectivePermissions` strategy sessions use, with the role each permission comes from.
`GET /api/users/search` and `GET /api/users/:id` return each person's `authId` and `roleIds`.

`updatedAt` on `PATCH` is the version the client read (the role's `updatedAt`); sent, the edit is
refused with `409` if the role changed since. Optional: omitted, the last edit wins. A client that
edits from a form should always send it.

`400` when a permission id does not exist or a field breaks its shape; `404` for an unknown role, or
(on the account operations) an unknown sign-in record; `409` when `code` already exists (per
`tenantId`). `authId` is the `auth` record id — the session subject — not the `users` profile id.

`add`, `remove` and `PUT` answer `{ response: 'roles updated', roleIds }` with the account's roles
afterwards; `add` and `remove` need at least one id and `roleIds` takes at most 50 (`400`
otherwise), and repeating either changes nothing. The change reaches the account's sessions at their
next refresh. The mutations are limited per operator (see
[Authorization](./authorization.md#rate-limit)).

**Refusals and their codes.** Every rejection of the role rules carries a stable `code` in the error
response, so a client chooses its message by code. Where a code comes with data, it is in `meta`.

| Status | `code`                           | When                                                                                    |
| ------ | -------------------------------- | --------------------------------------------------------------------------------------- |
| `403`  | `ROLE_SELF_CHANGE`               | The operation targets the caller's own account.                                         |
| `403`  | `ROLE_GRANT_EXCEEDS_SCOPE`       | It adds or takes away a permission the caller does not hold; `meta.missing` lists them. |
| `403`  | `ROLE_IS_SYSTEM`                 | A system role is edited or deleted.                                                     |
| `403`  | `ACTOR_NOT_ACCOUNT`              | The caller is a service credential, not an account.                                     |
| `403`  | `ACTOR_NOT_ACTIVE`               | The caller's account no longer exists or cannot sign in.                                |
| `403`  | `ACTOR_LACKS_PERMISSION`         | The caller no longer holds the route's permission; `meta.required` names it.            |
| `409`  | `LAST_ADMINISTRATOR`             | It would leave no account able to manage roles and sign in.                             |
| `409`  | `ROLE_HAS_HOLDERS`               | The role to delete is held; `meta.holderCount` and `meta.holderIds` (the first 20).     |
| `409`  | `ROLE_VERSION_CONFLICT`          | The role changed since the `updatedAt` sent.                                            |
| `409`  | `PERMISSION_VERSION_CONFLICT`    | The permission changed since the `updatedAt` sent.                                      |
| `409`  | `ROLE_CONCURRENT_CHANGE`         | An account's roles kept changing under the request; repeat it.                          |
| `500`  | `LAST_ADMINISTRATOR_UNDO_FAILED` | A change left nobody able to manage roles and could not be undone; restore one by hand. |

The rules themselves are in [Authorization](./authorization.md#roles-and-sessions). Creating,
editing and deleting a role, `PATCH /api/users/:id` (a `status` that blocks sign-in),
`PATCH /api/users/deactivate`, `DELETE /api/users` and `PATCH /api/permissions/:id` follow them too.

### Audit trail (`/api/audit`)

| Method and path  | Permission   | Request                                                                                                                                                                                                 |
| ---------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/audit` | `audit-read` | Query `actor?`, `targetKind?` (`role`, `account`, `permission`, `user`), `targetId?`, `action?`, `result?` (`pending`, `ok`, `denied`, `conflict`, `error`), `from?`, `to?` (ISO 8601), `page`, `limit` |

Newest first; `sortBy` may only name `createdAt`, `actor`, `action` or `result` (`400` otherwise).
An event has `actor`, `actorType`, `action` (`<domain>.<operation>`, e.g. `roles.add`), `target`
`{ kind, id }`, `request` (what was asked), `before` and `after` (ids and plain values), `result`,
`reason` (the rejection's `code`, or the status name), `requestId` and `createdAt`. `400` when a
date is not a real date or `from` is after `to`. A query parameter the endpoint does not know is
ignored; so is a `sortBy` key with a dot (`sortBy[target.id]`), which the query parser does not
accept as a sort key, and the default order applies. An order outside the closed list is never
applied. See [Authorization](./authorization.md#audit-trail).

### Permissions (`/api/permissions`)

| Method and path              | Permission                              | Request                                                            |
| ---------------------------- | --------------------------------------- | ------------------------------------------------------------------ |
| `POST /api/permissions`      | `permission-write`                      | Body `{ code, name, description, categories?, isActive? }`         |
| `GET /api/permissions`       | `permission-read` or `permission-write` | Query `query?`, `page`, `limit`                                    |
| `GET /api/permissions/:id`   | `permission-read` or `permission-write` | Param `id`                                                         |
| `PATCH /api/permissions/:id` | `permission-write`                      | Body `{ name?, description?, categories?, isActive?, updatedAt? }` |

`code` must match `module:action` (letters, digits and hyphens on each side). `409` for a duplicate
code, `404` for an unknown id. There is no delete; deactivate with `isActive: false`. Turning a
permission on or off needs the caller to hold it, and turning it off must leave an account able to
manage roles; `updatedAt` is the version read (`409` if the permission changed since, optional). See
[Authorization](./authorization.md#roles-and-sessions).

### Grant Access (`/api/grant-access`)

| Method and path                | Permission                                  | Request                                                                      |
| ------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------- |
| `POST /api/grant-access`       | `grant-access-write`                        | Body `{ userId, resourceId, tenantId?, accessLevel, expiresAt?, isActive? }` |
| `GET /api/grant-access`        | `grant-access-read` or `grant-access-write` | Query `userId?`, `resourceId?`, `tenantId?`, `page`, `limit`                 |
| `GET /api/grant-access/check`  | `grant-access-read` or `grant-access-write` | Query `userId`, `resourceId`, `tenantId?`, `accessLevel`                     |
| `GET /api/grant-access/:id`    | `grant-access-read` or `grant-access-write` | Param `id`                                                                   |
| `PATCH /api/grant-access/:id`  | `grant-access-write`                        | Body `{ accessLevel?, expiresAt?, isActive? }`                               |
| `DELETE /api/grant-access/:id` | `grant-access-write`                        | Param `id`                                                                   |

`userId` is the `users` profile id. `check` answers `{ allowed: boolean }`. `409` when a grant
exists for the same `{ userId, resourceId, tenantId }`; `404` for an unknown id. See
[Authorization](./authorization.md#grant-access).

### Notification templates (`/api/templates`)

`@zanix/notifications`' `createTemplatesController`, mounted by
[`templates.handler.ts`](../src/server/handlers/templates.handler.ts) behind a guard requiring the
`templates-access` permission on a `user` or `api` token.

| Method and path                        | Request                                 |
| -------------------------------------- | --------------------------------------- |
| `GET /api/templates/list`              | —                                       |
| `GET /api/templates/:channel/:name`    | Params `channel`, `name`                |
| `POST /api/templates`                  | Body: a template (`CreateTemplateRTO`)  |
| `PUT /api/templates/:channel/:name`    | Body: the changes (`UpdateTemplateRTO`) |
| `DELETE /api/templates/:channel/:name` | Answers `{ deactivated: name }`         |

Edits persist only with `TEMPLATES_BACKEND=local`. See `@zanix/notifications` for the template
fields.

### Hosted OAuth2 provider (`/api/oauth`)

`OAuthProviderController`
([`oauth-provider.handler.ts`](../src/server/handlers/oauth-provider.handler.ts)). The flow is
described in [Authentication flows](./authentication-flows.md#hosted-oauth2-provider).

| Method and path            | Rate limit (tier)   | Request                                                                                   |
| -------------------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| `GET /api/oauth/authorize` | `criticalRateLimit` | Query `client_id`, `redirect_uri`, `response_type=code`, `state?`                         |
| `POST /api/oauth/token`    | `freeRateLimit`     | Body `{ grant_type: 'authorization_code', code, client_id, client_secret, redirect_uri }` |

- **`authorize`** answers a `302`: to `redirect_uri?code=...&state=...` when the browser has an
  `iam` session, else to `/en/login?redirect_to=...` to sign in first. `400` for an unknown
  `client_id`, `403` for an unregistered `redirect_uri`.
- **`token`** answers `{ accessToken, refreshToken, expiresAt }`. `400` for a wrong
  `client_id`/`client_secret`; `403` for an unregistered `redirect_uri` or a code that is expired
  (60 seconds), already used, or issued to another client or redirect URI.

### Well-known discovery

`GET /.well-known/zanix/code-templates` (no REST prefix) lists the in-code notification templates,
enabled by `codeTemplatesDiscovery: true` in `mod.ts` so a central console can pull the catalog.

### See also

- [Authentication flows](./authentication-flows.md)
- [Authorization](./authorization.md)
- [Configuration](./configuration.md)
- [API reference](./api-reference.md)
- [README](../README.md)
