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

An account holds at most one role, `auth.roleId`, set by `POST /api/roles/assign`
(`{ authId, roleId }`, where `authId` is the `auth` record id that is also the session subject), by
the `defaultRoleId` config on self-registration, or by the first-administrator seeder.

When a session is issued (sign-in, second factor, recovery, reactivation, hosted-provider token
exchange) or refreshed, `iam` loads the role with its permissions and passes it to the `auth` app's
`resolveEffectivePermissions` behavior. The default ([`utils/rbac.ts`](../src/utils/rbac.ts))
returns the codes of the role's active permissions. The resulting list is the token's `aud` claim,
which `@AuthTokenValidation({ permissions })` checks with OR semantics. An account with no role gets
an empty list.

Because `POST /api/login/refresh` re-resolves the list, a role change or a deactivated permission
takes effect at the account's next refresh, without signing in again. The current access token keeps
its claims until it expires (at most one hour).

Replace the evaluation strategy (a hierarchy, wildcard expansion, an external policy engine) by
overriding `resolveEffectivePermissions`; see [Configuration](./configuration.md#behaviors). The
function receives the role with `permissions` populated (or `undefined`) and returns the list of
codes.

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
| `templatesAccess`  | `<SERVICE_ID>:templates-access`   | The whole `/api/templates` API                                   |

Self-service routes (own profile, own sign-in methods, own account deactivation) need only a
session.

### Seeded data and the first administrator

Production seeders (always run, idempotent by fixed id):

- permissions: `*` and every code in the table above;
- roles: `superadmin`, holding only `*`;
- the first administrator, when `FIRST_ADMIN_EMAIL` and `FIRST_ADMIN_PASSWORD` are both set: a
  profile and a sign-in record with the `superadmin` role.

Development seeders (skipped when `ENV=production`) add a profile and a sign-in record
`dev@<SERVICE_ID>.local` with the password `DevPass123!` and the `superadmin` role. See
[Deployment](./deployment.md#seeders).

A fresh production instance has no other way to create its first account: `POST /api/users/register`
itself needs `user-write`.

### Grant Access

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
