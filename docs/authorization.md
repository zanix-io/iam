## Authorization

`iam` has two independent authorization layers: an **RBAC catalog** (roles bundling permission
codes, resolved into every session token) and **Grant Access** (per-resource grants checked on
demand). Both support optional tenant scoping. Endpoints are listed in the
[REST API reference](./rest-api.md#roles-apiroles).

### Contents

- [Permissions](#permissions)
- [Roles and sessions](#roles-and-sessions)
- [Permission catalog (`RBAC_PERMISSIONS`)](#permission-catalog-rbac_permissions)
- [Seeded data and the first administrator](#seeded-data-and-the-first-administrator)
- [Grant Access](#grant-access)
- [Multi-tenancy](#multi-tenancy)
- [See also](#see-also)

### Permissions

A permission ([`permissions/model.defs.ts`](../src/server/repositories/permissions/model.defs.ts))
has a globally unique `code` in `module:action` form (letters, digits and hyphens on each side, e.g.
`orders:refund`), a `name`, a `description`, optional `categories`, and `isActive`. Only active
permissions reach a token; deactivate one with `PATCH /api/permissions/:id` (`isActive: false`),
there is no delete.

The code `*` is the wildcard: `@zanix/auth` treats a token holding it as passing every permission
check.

### Roles and sessions

A role ([`roles/model.defs.ts`](../src/server/repositories/roles/model.defs.ts)) has a `code`, a
`name`, a `description`, an optional `tenantId`, and a list of permission ids. `{ code, tenantId }`
is unique, so the same code can exist once per tenant and once without one.

An account holds a list of roles, `auth.roleIds`, and its permissions are the union of what each
role grants. The list is set at registration (the `defaultRoleId` config becomes its first entry),
by the first-administrator seeder, and through the role endpoints of
[Roles](./rest-api.md#roles-apiroles): `POST /api/roles/add` and `POST /api/roles/remove` change the
list one role at a time, `PUT /api/roles/accounts/:authId` sets it whole, and
`POST /api/roles/assign` makes one role the only one (it replaces the list). `authId` is the `auth`
record id that is also the session subject. Prefer `add` to give an account an extra role, so the
default role stays: a seller holding `web-user` and `seller` keeps the permissions of both.

#### System roles

A role can be marked `isSystem` (the seeded `superadmin` is). A system role is never edited or
deleted, by anyone, a holder of `*` included (`403`, `ROLE_IS_SYSTEM`). The field is optional and
immutable once set, and only a caller holding `*` can create a role with it. A role without the
field behaves as an ordinary one, so existing roles keep working.

**Upgrading an installation that already has `superadmin`.** Starting the server marks it: a roles
seeder sets `isSystem: true` on `superadmin` when the field is missing and changes nothing else. To
check it, or to do it before starting, run this in `mongosh` on the database `iam` uses:

```js
db.roles.updateOne({ _id: ObjectId('693000000000000000000201'), isSystem: { $exists: false } }, {
  $set: { isSystem: true },
})
```

Without this step `superadmin` is still guarded, because editing or deleting a role needs holding
every permission it carries and `superadmin` carries `*`, so only a holder of `*` can; but it is not
immutable for that holder, who could rename or delete it. The other upgrade steps are in the
CHANGELOG ("Upgrading from 1.x").

#### Who may grant what

`role-write` is not superadmin. Whoever assigns roles (`assign`, `add`, `remove`, `PUT`), creates a
role, edits a role's permissions, deletes a role, turns a permission on or off, or blocks a person
may only touch permissions the caller holds, and holding `*` holds all of them. The check compares
with `@zanix/auth`'s `scopeValidation`, so only a holder of `*` can grant a role that carries `*`.
Taking away counts as much as adding, so a `role-write` holder cannot degrade a more privileged
account. Only what changes is checked; roles an account keeps are not. Refused with `403`
(`ROLE_GRANT_EXCEEDS_SCOPE`, the permissions missing in `meta.missing`). Every role change also
refuses the caller's own account (`403`, `ROLE_SELF_CHANGE`). Two cases in particular:

- Turning a permission on or off (`PATCH /api/permissions/:id`, `isActive`) grants or takes it away
  from every role that carries it, so the caller must hold it; the other fields need nothing.
- `user-write` cannot block a person (`PATCH /api/users/:id` to `INACTIVE` or `DELETED`) whose roles
  grant something the caller does not hold. Deactivating or deleting your own account is about
  yourself and is exempt.

The role contents of a create or an edit are checked by the codes of the permissions in the catalog,
active or not; assigning a role is checked by what it grants today. The first reading is the
conservative one and is safe because turning an inactive permission on is gated by the rule above.

**The caller is an account, read from the database, not from the token.** Every mutation of roles,
permissions and account status looks the caller up after the route's own
`@AuthTokenValidation({ permissions })` has passed, so only someone who holds the administrative
permission in the token gets that far. Three things are then required, with the roles the caller
holds NOW, so an administrator who was demoted stops acting at once instead of when the access token
expires:

- The caller is an account: a `user` session whose `auth` record exists. A service credential is
  never a caller, whatever scope it carries: as an `api` session, or as a token whose subject is a
  service name and not an account id (a guard sets the session type from the header the token came
  on, not from the token), it is refused (`403`, `ACTOR_NOT_ACCOUNT`).
- The account can sign in: its profile is not `INACTIVE` or `DELETED` (`403`, `ACTOR_NOT_ACTIVE`).
- It still holds the permission of the route, `role-write` for roles, `permission-write` for
  permissions, `user-write` for accounts (`403`, `ACTOR_LACKS_PERMISSION`, the permission in
  `meta.required`; `*` holds all). This applies to every mutation, even one that grants nothing: a
  demoted administrator cannot rename a role, create one with no permissions, delete one nobody
  holds or edit a person. Deactivating or deleting your own account is self-service, not an
  administration mutation, and is exempt.

It costs one read of the caller's account plus the roles query the operation already makes (the
caller's roles are read together with the ones being changed, or reuse the catalog the operation
read). The ordinary request path is unchanged: it is the token alone, and session issuance does not
change.

#### An administrator remains

No change may take the system from having an account that can manage roles and sign in to having
none (`409`, `LAST_ADMINISTRATOR`). "Able to manage roles" is a permission, not a role id: a role
qualifies when its active permissions include `role-write` or `*` (the same check, through the same
`resolveEffectivePermissions` strategy sessions use), so it holds whatever the administrator role is
called. It is checked on every path that can remove the last such account:

- changing an account's roles (`assign`, `add` when it removes, `remove`, `PUT`);
- editing a role's permissions, and deleting a role;
- setting a profile `INACTIVE` or `DELETED` (`PATCH /api/users/:id`, `PATCH /api/users/deactivate`,
  `DELETE /api/users`);
- deactivating a permission (`PATCH /api/permissions/:id` with `isActive: false`).

A system that has no such account at all (a fresh install) has nothing to protect, so the check
passes.

An account counts when it can sign in by the rule every login path applies
(`UsersRepository.assertActive`): its profile is not `INACTIVE` or `DELETED`. Two edge cases follow
from that rule on purpose:

- An account with no linked profile, or whose `userId` matches no profile, passes the sign-in gate
  and so counts as an administrator (a "ghost holder"). Link a profile or remove its roles if that
  is not what you want.
- A role with a `tenantId` counts like any other: the permissions in a token are global to this
  service whatever tenant the role belongs to, so a tenant-scoped role carrying `role-write` is real
  administration. Do not give `role-write` or `*` to a tenant-scoped role unless that is intended.

**Concurrency.** Every one of those paths runs through the same piece (`role-admin.ts`): it checks
before writing, writes, counts the administrators again, and if two requests together removed the
last one, undoes its own write (restores the account's roles, the role's permissions or the deleted
role, the profile's status, the permission's `isActive`) and refuses with `409`. Changing an
account's roles writes only if the account still holds what was read, repeating up to three times
(`ROLE_CONCURRENT_CHANGE` after that); `add` is a single atomic `$addToSet`. What remains: the
system can show no administrator for the instant between that write and its undo. If the undo itself
cannot be applied because its target changed again, the response is a `500`
(`LAST_ADMINISTRATOR_UNDO_FAILED`, logged) and an administrator must be restored by hand. The
first-administrator seeder does not do it: it only inserts, so it does nothing for an account that
already exists. In `mongosh`, give an existing account the superadmin role back:

```js
db.auths.updateOne(
  { _id: ObjectId('<authId>') },
  { $addToSet: { roleIds: ObjectId('693000000000000000000201') } },
)
```

`@zanix/datamaster`'s transactions need a replica set and cover one collection, so they are not
used.

#### Deleting a role, and concurrent edits

A role that accounts hold is not deleted: `409` (`ROLE_HAS_HOLDERS`) with the number of holders and
the first ones in `meta`. Remove it from them first (`GET /api/roles/:id/holders` lists them).
`PATCH` of a role or a permission takes an optional `updatedAt`, the version the client read: if the
record changed since, the edit is refused (`409`, `ROLE_VERSION_CONFLICT` or
`PERMISSION_VERSION_CONFLICT`). A client that edits from a form should always send it. Omitted, the
edit of a role's permissions is still conditioned on the version the request itself read, because it
was decided (grant rule, administrator rule) from what it read: a concurrent edit between the read
and the write makes it fail with `ROLE_VERSION_CONFLICT`, to be repeated. Only an edit of name and
description with no version sent is last-wins.

#### Audit trail

Every mutation of roles, permissions and account status is written to the `role_audit_events`
collection, rejected attempts included, whatever the reason: a rule (`403`/`409`), a record that is
not there (`404`), a caller that is not an active account, or a request that is malformed past the
guard. An event is written as `pending` before anything changes and closed afterwards as `ok`,
`denied` (a `403`), `conflict` (a `409`) or `error`, with the rejection's stable `code` as its
reason (or the status name, `NOT_FOUND`). It records who did it (`actor`, `actorType`), what it
targeted (`target`: kind and id; a role or permission just created gets its id once it exists), the
`request` as asked, the ids `before` and `after`, and the request id. It holds ids, codes and counts
only: no email, token or secret. Account creation (`POST /users/register`) is not on the trail.

It fails closed: if the event cannot be written the change is not made. Closing the event is best
effort: if that write fails, the operation's own outcome stands, the failure is logged
(`Could not close audit event ...`) and the event stays `pending`. A `pending` event whose request
died (a process stopped midway) is told apart by its age: list them with
`GET /api/audit?result=pending&to=<now minus a few minutes>`; a recent `pending` is a request still
running. They expire with the rest, after `AUDIT_RETENTION_DAYS`.

`GET /api/audit` (permission `audit-read`) lists events newest first, filtered by actor, target,
action, result and date range; `sortBy` may only name `createdAt`, `actor`, `action` or `result`
(`400` otherwise). Events expire after `AUDIT_RETENTION_DAYS` (default 365); see
[Configuration](./configuration.md#audit-and-administration-limits).

#### Rate limit

The mutations above (roles, permissions and `PATCH /api/users/:id`) are limited per operator, in a
bucket of their own: `ADMIN_MUTATION_RATELIMIT` requests (default 30) per
`ADMIN_MUTATION_RATELIMIT_WINDOW_SECONDS` (default 60), counted after the token is validated, so an
anonymous caller never reaches it. The bucket is the operator's account, not their access token: a
new login or a refresh does not start a new count, and two operators never share one. A `429`
carries `Retry-After`.

The limit is `@zanix/auth`'s `RateLimitGuard` with an explicit `limit` and `key: 'subject'`: the
configured figure is an absolute request count (never looked up in `RATE_LIMIT_PLANS`), and the
`X-Znx-RateLimit-Limit` and `-Remaining` headers of these routes report it.

#### Sessions

When a session is issued (sign-in, second factor, recovery, reactivation, hosted-provider token
exchange) or refreshed, `iam` loads each role of the account with its permissions and passes it to
the `auth` app's `resolveEffectivePermissions` behavior. The default
([`utils/rbac.ts`](../src/utils/rbac.ts)) returns the codes of the role's active permissions. The
lists of all the roles are merged without repeats into the token's `aud` claim, which
`@AuthTokenValidation({ permissions })` checks with OR semantics. An account with no role gets an
empty list.

Because `POST /api/login/refresh` re-resolves the list, a role change or a deactivated permission
takes effect at the account's next refresh, without signing in again. The current access token keeps
its claims until it expires (at most one hour).

Replace the evaluation strategy (a hierarchy, wildcard expansion, an external policy engine) by
overriding `resolveEffectivePermissions`; see [Configuration](./configuration.md#behaviors). The
function receives ONE role with `permissions` populated (or `undefined`) and returns its list of
codes; `iam` calls it for each role of the account and merges the results.

### Permission catalog (`RBAC_PERMISSIONS`)

The permissions that gate `iam`'s own admin endpoints
([`utils/constants.ts`](../src/utils/constants.ts)). Each code is prefixed with `SERVICE_ID`
(`zanix-iam` by default). Every read route accepts the read or the write permission; every mutation
requires the write permission.

| Key                | Code                              | Gates                                                            |
| ------------------ | --------------------------------- | ---------------------------------------------------------------- |
| `roleRead`         | `<SERVICE_ID>:role-read`          | Listing and reading roles                                        |
| `roleWrite`        | `<SERVICE_ID>:role-write`         | Creating, editing, deleting and assigning roles                  |
| `permissionRead`   | `<SERVICE_ID>:permission-read`    | Listing and reading permissions                                  |
| `permissionWrite`  | `<SERVICE_ID>:permission-write`   | Creating and editing permissions                                 |
| `userRead`         | `<SERVICE_ID>:user-read`          | Searching and reading any profile                                |
| `userWrite`        | `<SERVICE_ID>:user-write`         | Registering accounts and editing any profile, including `status` |
| `grantAccessRead`  | `<SERVICE_ID>:grant-access-read`  | Listing, reading and checking grants                             |
| `grantAccessWrite` | `<SERVICE_ID>:grant-access-write` | Creating, editing and revoking grants                            |
| `auditRead`        | `<SERVICE_ID>:audit-read`         | Reading the audit trail (`GET /api/audit`)                       |
| `templatesAccess`  | `<SERVICE_ID>:templates-access`   | The whole `/api/templates` API                                   |

Self-service routes (own profile, own sign-in methods, own account deactivation) need only a
session.

### Seeded data and the first administrator

Production seeders (always run, idempotent by fixed id):

- permissions: `*` and every code in the table above. Existing databases receive the ones they are
  missing at startup (for example `audit-read`); a permission that already exists under the same
  code but another id is kept, and the seeded one is skipped with a warning;
- roles: `superadmin`, a system role holding only `*`. An existing `superadmin` without `isSystem`
  is marked at startup;
- the first administrator, when `FIRST_ADMIN_EMAIL` and `FIRST_ADMIN_PASSWORD` are both set: a
  profile and a sign-in record with the `superadmin` role.

Development seeders (skipped when `ENV=production`) add a profile and a sign-in record
`dev@<SERVICE_ID>.local` with the password `DevPass123!` and the `superadmin` role. See
[Deployment](./deployment.md#seeders).

A fresh production instance has no other way to create its first account: `POST /api/users/register`
itself needs `user-write`.

### Grant Access

> In 2.0.0 Grant Access is outside the rules of role administration: its endpoints are not written
> to the audit trail, are not limited by the administration rate limit, and do not check the caller
> against the database (`authorizeActor`); they are guarded by the token's `grant-access-read` /
> `grant-access-write` permissions alone.

A grant ([`grant-access/model.defs.ts`](../src/server/repositories/grant-access/model.defs.ts),
collection `grant_accesses`) records that a `users` profile (`userId`, the profile id, not the
`auth` id) has an `accessLevel` on a `resourceId`, optionally within a `tenantId`, with optional
`expiresAt` and an `isActive` flag. `{ userId, resourceId, tenantId }` is unique.

`resourceId` is an opaque string `iam` never interprets. For a check about one of an app's own
operations, the model's documented convention is `"<appName>:<operationName>"`.

`accessLevel` is free-form. The default `evaluateGrantAccess` behavior
([`utils/grant-access.ts`](../src/utils/grant-access.ts)) answers `false` for a missing, inactive or
expired grant, orders `READ` < `WRITE` < `MANAGE` (a higher level satisfies a lower requirement),
and compares any other level by exact equality. Override the behavior on the `grant-access` app to
change this.

Two ways to ask:

- REST: `GET /api/grant-access/check?userId=...&resourceId=...&accessLevel=...` answers
  `{ allowed }`, gated by `grant-access-read` or `grant-access-write`.
- Another Zanix App: the `grant-access` app exposes a `checkAccess` operation, callable through
  `ctx.remote('grant-access').call('checkAccess', { userId, resourceId, tenantId, accessLevel })`,
  open to every caller unless the host sets `allowedCallers` when composing it.

Grants are not part of the session token; each check reads the current grant.

### Multi-tenancy

One `iam` deployment serves one product. `tenantId` on roles and grants partitions that product's
data per customer or organization: it is a data filter (an exact match in searches and in the
uniqueness indexes), not a separate authorization mechanism, and `RBAC_PERMISSIONS` needs no
tenant-specific entries. `iam` does not validate tenant ids; the consuming system owns them.

To isolate a different set of accounts entirely (for example staff), run a second instance with its
own `MONGO_DB_NAME`; see [Deployment](./deployment.md#a-second-instance).

### See also

- [REST API reference](./rest-api.md)
- [Authentication flows](./authentication-flows.md)
- [Configuration](./configuration.md)
- [README](../README.md)
