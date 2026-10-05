# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/) and this project
adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [2.0.1] - 2026-10-05

### Fixed

- A database that already ran 1.x never received the data 2.0.0 added to the seeders, because a
  seeder runs once per name and version and the permissions seeder kept its old version. Two things
  were missing there: the `audit-read` permission (so `GET /api/audit` could not be granted) and
  `isSystem` on the `superadmin` role (so a holder of `*` could still edit or delete it). Both are
  now written at startup, once: the permissions seeder (`seedMissingPermissions`, version `1.2.0`)
  inserts only the seeded permissions that are missing, and a roles seeder
  (`markSuperadminAsSystem`, version `1.1.0`) sets `isSystem: true` on `superadmin` only when the
  field is absent, touching nothing else. A fresh database is unaffected. If a permission with the
  code `audit-read` was created by hand under another id, it is kept as it is, the seeded one is
  skipped and a warning is logged: grant that permission, or delete it so the seeder can insert its
  own.
- An installation that already started 2.0.0 without this fix gets both on its next start of the
  fixed version; nothing has to be run by hand. Step 6 of "Upgrading from 1.x" below stays as a
  check and as a manual alternative.

## [2.0.0] - 2026-10-05

### Upgrading from 1.x (read this first)

This release changes the stored shape of `auth` and adds fields and a collection. Take a backup, run
the steps in order, on the database `iam` uses (`MONGO_DB_NAME`), in `mongosh`, with MongoDB 4.2 or
later, and only then start the new version. The collections are `auths`, `roles`, `permissions`,
`users` and `role_audit_events` (the names Mongoose gives the models `auth`, `roles`, `permissions`,
`users` and `role_audit_events`; check them with `show collections`).

```sh
for collection in auths roles; do
  mongodump --uri "$MONGO_URI" --db "$MONGO_DB_NAME" --collection "$collection" \
    --out ./backup-before-2.0
done
```

`auths` is what steps 3, 4 and 8 change and `roles` what step 6 changes; nothing else is modified.
Restoring both with `mongorestore` undoes the whole upgrade.

**1. Count before.**

```js
db.auths.countDocuments({ roleId: { $exists: true } }) // accounts with a role: N
db.auths.countDocuments({ roleId: { $exists: true, $not: { $type: 'objectId' } } }) // should be 0
```

If the second count is not 0, those accounts hold a `roleId` that is not an id. Check what they hold
before going on, because step 4 removes the field from every one of them, silently:

```js
db.auths.aggregate([
  { $match: { roleId: { $exists: true, $not: { $type: 'objectId' } } } },
  { $group: { _id: { $type: '$roleId' }, accounts: { $sum: 1 } } },
])
```

A `roleId` of type `string` is an id stored as text; step 2 converts it. A `null` has no role to
keep, and the others (numbers, objects) are not roles at all; step 4 removes them and those accounts
stay without roles.

**2. Convert a `roleId` stored as text.** An id written as a string would be skipped by step 3 and
then dropped by step 4. This turns the ones that are valid ids into ids and leaves the rest (`null`)
for step 4; a string that is not a valid id becomes `null` too. Running it again matches nothing.

```js
db.auths.updateMany({ roleId: { $type: 'string' } }, [
  { $set: { roleId: { $convert: { input: '$roleId', to: 'objectId', onError: null } } } },
])
```

**3. Copy `roleId` into `roleIds`.** It keeps an existing `roleIds` and otherwise builds it from
`roleId`, and it only matches a real id, so it never produces `[null]`. Running it again matches
nothing.

```js
db.auths.updateMany({ roleId: { $type: 'objectId' } }, [
  {
    $set: {
      roleIds: {
        $cond: [
          { $gt: [{ $size: { $ifNull: ['$roleIds', []] } }, 0] },
          '$roleIds',
          ['$roleId'],
        ],
      },
    },
  },
  { $unset: 'roleId' },
])
```

**4. Remove a `roleId` that is not an id.**

```js
db.auths.updateMany({ roleId: { $exists: true } }, { $unset: { roleId: '' } })
```

**5. Count after.**

```js
db.auths.countDocuments({ roleId: { $exists: true } }) // 0
db.auths.countDocuments({ 'roleIds.0': { $exists: true } }) // N, plus any account that already had roleIds
```

**6. Mark the seeded `superadmin` as a system role.** Starting the fixed version does this already
(a roles seeder sets `isSystem` on `superadmin` when the field is missing); run the command to check
it, or to do it before starting. Without `isSystem`, `superadmin` is still guarded (only a holder of
`*` can edit or delete a role that carries `*`) but it is not immutable for that holder, and a
holder of `*` could rename or delete it.

```js
db.roles.updateOne({ _id: ObjectId('693000000000000000000201'), isSystem: { $exists: false } }, {
  $set: { isSystem: true },
})
```

**7. Look at old data the new rules would reject (read-only), after step 3.** Roles written before
`name`, `code` and `description` were validated can break the new shape; they keep working and are
only checked when edited. This lists them:

```js
const edge = '[^\\s\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]'
const body = '[^\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]*'
const shape = new RegExp(`^${edge}(?:${body}${edge})?$`, 'u')
const code = /^[a-z0-9]+(?:[-_.:][a-z0-9]+)*$/
const within = (text, min, max) =>
  typeof text === 'string' && text.length >= min && text.length <= max
db.roles.find().forEach((role) => {
  const ok = within(role.name, 2, 80) && shape.test(role.name) &&
    within(role.code, 2, 64) && code.test(role.code) &&
    within(role.description, 1, 500) && shape.test(role.description)
  if (!ok) printjson({ _id: role._id, code: role.code, name: role.name })
})
```

**8. Remove role ids that point at no role.** Before this release, deleting a role left its id in
the accounts that held it; the session ignored it. Count them, then remove them:

```js
const existing = db.roles.find({}, { _id: 1 }).toArray().map((role) => role._id)
db.auths.countDocuments({ roleIds: { $elemMatch: { $nin: existing } } })
db.auths.updateMany({ roleIds: { $elemMatch: { $nin: existing } } }, {
  $pull: { roleIds: { $nin: existing } },
})
```

**Rolling back to 1.2.0.** 1.2.0 reads `roleId` and ignores `roleIds`, so after migrating, accounts
have no role on 1.2.0. To go back, give each migrated account its first role again (an account with
several roles keeps only that one on 1.2.0; `roleIds` stays in the document and 1.2.0 ignores it),
or restore the backup of `auths` taken above if no account changed since:

```js
db.auths.updateMany({ 'roleIds.0': { $exists: true } }, [
  { $set: { roleId: { $arrayElemAt: ['$roleIds', 0] } } },
])
```

The audit collection (`role_audit_events`) is new and 1.2.0 never writes it; leave it or drop it.

### Changed

- **BREAKING: the `roleId` field of the `auth` model is replaced by `roleIds`**, a list of `roles`
  ids (`AuthenticationAttrs.roleIds`, indexed). An account can hold several roles, and a session
  carries the union, without repeats, of the permissions of every role in it.
  `resolveEffectivePermissions` keeps its one-role signature: `iam` calls it for each role and
  merges the results. `roleId` is gone from the schema, the types, `AuthRepository.registerAuth` and
  the seeders, and nothing reads it: an account that still has only `roleId` has no role, so
  **existing documents must be migrated before this version runs** (see "Upgrading from 1.x" above
  for the commands, the counts to check and the rollback).
- The role assigned by `defaultRoleId` at registration, the dev account and the first-administrator
  seeder are written as `roleIds`; the default role is the first entry and adding roles after it
  does not replace it. `POST /api/roles/assign` `{ authId, roleId }` keeps its request: the role
  becomes the account's only one. To give an account an extra role and keep the ones it has, use
  `POST /api/roles/add`.
- **Role administration enforces rules on every path, and they were all absent before.**
  - _Grant only what you hold._ `role-write` is not superadmin. Assigning, adding or removing roles,
    creating a role, editing a role's permissions, deleting a role, turning a permission on or off
    (`isActive`) and blocking a person (`PATCH /api/users/:id` to `INACTIVE`/`DELETED`) are refused
    (`403`) when they add or take away a permission the caller does not hold (`*` holds all; only
    `*` can grant `*`), using `@zanix/auth`'s `scopeValidation`. A caller's own account is refused
    too. Deactivating or deleting your own account is exempt.
  - _The caller is an account, read from the database, not the token._ After the route's
    `@AuthTokenValidation({ permissions })` passes, every mutation of roles, permissions and account
    status requires that the caller is an account (`403`, `ACTOR_NOT_ACCOUNT`: a service credential
    never is, as an `api` session or as a token whose subject is not an account id), that it can
    sign in (`ACTOR_NOT_ACTIVE`) and that it still holds the permission of the route
    (`ACTOR_LACKS_PERMISSION`: `role-write`, `permission-write` or `user-write`, `*` included), with
    the roles it holds now, so a demoted administrator stops acting at once even for what grants
    nothing (renaming a role, creating one with no permissions). One read of the caller, folded into
    the roles query the operation makes; the ordinary request path and session issuance are
    unchanged. `POST /users/register` and `POST /permissions` need it too. Deactivating or deleting
    your own account is exempt.
  - _An administrator remains._ No change may leave no account able to manage roles (a role whose
    active permissions include `role-write` or `*`) that can sign in (`409`). It covers changing an
    account's roles, editing or deleting a role, setting a profile `INACTIVE`/`DELETED` (including
    `deactivate` and `DELETE /api/users`) and deactivating a permission. An account counts when its
    profile is not `INACTIVE`/`DELETED`, the rule `UsersRepository.assertActive` applies at login,
    now shared as `blocksSignIn`; an account with no profile counts. Roles with a `tenantId` count
    like any other. Every one of these paths is written to the audit trail, checked before writing,
    counted again after, and undone with a `409` if two requests together removed the last
    administrator (an undo that cannot be applied is a `500`, `LAST_ADMINISTRATOR_UNDO_FAILED`).
    Changing an account's roles writes only if the account still holds what was read (up to three
    attempts); `add` is one atomic `$addToSet`.
- **Deleting a role that accounts hold is refused** (`409`, `ROLE_HAS_HOLDERS`, with the count and
  the first holder ids in `meta`) instead of leaving dangling role ids. Remove the role from its
  holders first.
- **System roles.** `roles.isSystem` is optional and immutable; a system role is never edited or
  deleted (`403`, `ROLE_IS_SYSTEM`), and only a holder of `*` creates one. The seeded `superadmin`
  is a system role. A role without the field behaves as before; an installation that already has
  `superadmin` marks it in step 6 of "Upgrading from 1.x".
- **Strict role input.** `name` (2 to 80 characters), `code` (lowercase letters and digits joined by
  `-`, `_`, `.`, `:`) and `description` (1 to 500) are validated with `@zanix/validator`, rejecting
  control, bidirectional and zero-width characters and edge spaces; a role carries at most 200
  permissions (`MAX_PERMISSIONS_PER_ROLE`) and a repeated permission is stored once. `roleIds` takes
  at most 50 ids per request. Roles created before this can hold values the new shape would reject;
  they are only checked when edited.
- **Edits can carry the version they read.** `PATCH /api/roles/:id` and `PATCH /api/permissions/:id`
  take an optional `updatedAt`; if the record changed since, the edit is refused (`409`,
  `ROLE_VERSION_CONFLICT` / `PERMISSION_VERSION_CONFLICT`). Optional so existing clients keep
  working; `console` should always send it. Without it, a change of a role's permissions is still
  conditioned on the version the request read (it was decided from that state), so a concurrent edit
  fails it with `ROLE_VERSION_CONFLICT` to be repeated; only name and description alone are
  last-wins.
- **Stable error codes.** Every refusal of these rules has a `code` in the response
  (`ROLE_SELF_CHANGE`, `ROLE_GRANT_EXCEEDS_SCOPE` with `meta.missing`, `ACTOR_NOT_ACCOUNT`,
  `ACTOR_NOT_ACTIVE`, `ACTOR_LACKS_PERMISSION`, `LAST_ADMINISTRATOR`, `ROLE_HAS_HOLDERS`,
  `ROLE_IS_SYSTEM`, `ROLE_VERSION_CONFLICT`, `PERMISSION_VERSION_CONFLICT`,
  `ROLE_CONCURRENT_CHANGE`), exported as `IAM_ERROR_CODES`.
- **A rate limit for administration mutations**: roles, permissions and `PATCH /api/users/:id` are
  limited per operator (the account, not the access token: a new login does not start a new count)
  in a bucket of their own, `ADMIN_MUTATION_RATELIMIT` requests (default 30) per
  `ADMIN_MUTATION_RATELIMIT_WINDOW_SECONDS` (default 60). It is `@zanix/auth`'s native
  `RateLimitGuard` with an explicit `limit` and `key: 'subject'`: the figure is an absolute count
  (never read as a `RATE_LIMIT_PLANS` index) and the `X-Znx-RateLimit-Limit`/`-Remaining` headers of
  those routes report it.
- **`@zanix/auth` is `^1.7.0`** (it was `^1.6.0`), the first version with `RateLimitGuard`'s `limit`
  and `key` options and `missingScopes`. The grant rule uses `missingScopes(required, held)`;
  `utils/rbac.ts` no longer has its own `missingPermissions`.
- `GET /api/users/search` and `GET /api/users/:id` also return each person's `authId` and `roleIds`;
  `GET /api/roles/:id` also returns `holderCount`.
- Sessions read the roles of an account with one query (`RolesRepository.findManyWithPermissions`),
  and `AuthService` and `PasswordService` share one resolution (`permissionsForAccount`, in
  `interactors/session-permissions.ts`; `utils/rbac.ts` keeps only pure functions).
- An account that stores a role twice (a `roleIds` with a repeated id) can be changed: the
  conditional writes compare the array exactly as stored instead of a de-duplicated copy.

### Fixed

- **The server starts without `TEMPLATES_BACKEND=local`.** `auth.app.ts` seeded the database-only
  `totp-enabled` template at boot whatever the setting, so without the variable (the documented
  default, "templates render from code") the templates model did not exist and the server failed
  before listening. The seeding now runs only when `TEMPLATES_BACKEND=local`
  (`isTemplatesResourceEnabled('local')`), the "TOTP enabled" notice (that template) is sent only
  then, and `/api/templates`, which would have answered `500` on every call, answers `404`
  (`TEMPLATES_BACKEND_DISABLED`) to a caller allowed to use it.
- `ADMIN_MUTATION_RATELIMIT` and `ADMIN_MUTATION_RATELIMIT_WINDOW_SECONDS` are validated as positive
  integers: a value that is set and is not (`-5`, `0`, `1.5`, `abc`) stops the boot
  (`IAM_INVALID_POSITIVE_INTEGER_ENV`); it used to be accepted, and `-5` made every mutation a
  `429`. Unset or empty is still the default.

### Added

- Role endpoints for the list, all gated by `role-write` (reading by `role-read` or `role-write`):
  `POST /api/roles/add` `{ authId, roleIds }`, `POST /api/roles/remove` `{ authId, roleIds }`,
  `PUT /api/roles/accounts/:authId` `{ roleIds }` and `GET /api/roles/accounts/:authId`, backed by
  `RolesService.addRoles`, `removeRoles`, `setRoles` and `getAccountRoles`.
- `GET /api/roles/:id/holders`: one page of the people holding a role (`authId`, `userId`, name and
  status, no contact data) with the total.
- `GET /api/roles/accounts/:authId/permissions`: what an account can do today, each permission with
  the roles it comes from, resolved with the same `resolveEffectivePermissions` sessions use.
- **Audit trail.** Every mutation of roles, permissions and account status is written to the new
  `role_audit_events` collection, rejected attempts included whatever the reason (a rule, a missing
  record, a caller that is not an active account, `PATCH /users/:id` among them): `pending` before
  the change, then `ok`, `denied`, `conflict` or `error` with the rejection's `code`; it records the
  request as asked apart from the ids before and after, and the id of what was just created. It
  holds ids, codes and counts, never contact data or secrets, and fails closed (no event, no
  change). A `pending` event whose request died is found with `result=pending` and an age bound
  (`docs/authorization.md`). `GET /api/audit` lists it, newest first, filtered by actor, target,
  action, result and date range (`sortBy` only on `createdAt`, `actor`, `action`, `result`), with
  the new permission `audit-read` (seeded). Events expire after `AUDIT_RETENTION_DAYS` (default 365,
  a TTL index; the `collMod` to change it on an existing database is in `docs/configuration.md`).
- `effectiveRoleIds`, `unionPermissions`, `resolveRolePermissions`, `permissionsOfRoles`,
  `storedRoleIds` in `utils/rbac.ts`; `RolesRepository.findManyByIds`, `findManyWithPermissions`,
  `findAllWithPermissions`, `replacePermissions` and `restoreRole`;
  `AuthRepository.findHoldersOfRoleIds`, `addRoleIds`, `replaceRoleIds`, `pullRoleIds`,
  `findByUserId`, `findRolesByUserIds`, `countHolders` and `searchHolders`;
  `UsersRepository.findSignInBlockedIds`, `findManyByIds` and `restoreStatus`;
  `PermissionsRepository.restoreActive`; `blocksSignIn` and `SIGN_IN_BLOCKING_USER_STATUS` in
  `utils/constants.ts`.

## [1.2.0] - 2026-10-05

### Added

- **The countdown announcements of `RateLimitCountdown` and `OtpResend` are translatable.** Both
  Comets (and `RateLimitCardProps`, `LoginPasswordStepLabels`) take three optional string props,
  `announcementDone`, `announcementLessThanMinute` and `announcementMinutes`, and pass them to
  `Countdown`. `iam`'s views resolve them from three new catalog keys in `en` and `es`:
  `login/countdown/announcement-done`, `login/countdown/announcement-less-than-minute` and
  `login/countdown/announcement-minutes` (its `{minutes}` marker stays literal for `Countdown` to
  fill). `countdownAnnouncements(formatMessage)`, exported from
  `@zanix/iam/ui/sdk/countdown-announcements`, resolves the three for an app composing the Comets
  itself. Without the props the announcement stays in English, as before.

### Changed

- `@zanix/space-ui` is `^2.9.4` (was `^2.4.0`), the first version whose `Countdown` takes the
  announcement props.
- The default stylesheet is authored as `ui/styles.css` and imported as text by `ui/styles.ts`
  (`import css from './styles.css' with { type: 'text' }`). `IAM_UI_CSS` and `iamCssSource` keep the
  same names and the same rules, and a published `@zanix/iam` builds with any `@zanix/cli`. An app
  that links a local checkout needs `@zanix/cli` 2.2.8 or later: earlier versions read a local
  `.css` import as a CSS Module and hand `cssSources` an empty stylesheet.

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
