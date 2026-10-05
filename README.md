# Zanix IAM

[![Release](https://img.shields.io/github/v/release/zanix-io/iam?color=blue&label=git)](https://github.com/zanix-io/iam/releases)

[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://opensource.org/licenses/MIT)

## Table of Contents

1. [Description](#description)
2. [Features](#features)
3. [Structure](#structure)
4. [Installation](#installation)
5. [Environment variables](#environment-variables)
6. [Basic Usage](#basic-usage)
7. [Documentation](#documentation)
   - [Authentication flows](./docs/authentication-flows.md)
   - [Authorization](./docs/authorization.md)
   - [REST API reference](./docs/rest-api.md)
   - [Configuration](./docs/configuration.md)
   - [Customization](./docs/customization.md)
   - [Deployment](./docs/deployment.md)
   - [Consuming iam](./docs/consuming-iam.md)
   - [API reference](./docs/api-reference.md)
   - [See more](./docs/see-more.md)
8. [Testing](#testing)
9. [Contributing](#contributing)
10. [Changelog](#changelog)
11. [License](#license)
12. [Resources](#resources)

## Description

An identity service built on `@zanix/server`/`@zanix/space`/`@zanix/auth`: multi-user
password/OTP/TOTP/OAuth2 login, refresh-token session management, and an RBAC catalog
(roles/permissions) plus fine-grained per-resource access grants. `Zanix.start()` serves everything
from one process (`mod.ts`): the project's own REST controllers (auto-discovered from the project
root, covering both the `auth` and `grant-access` domain slices), the `auth` and `grant-access`
Zanix Apps themselves (configuration/resources/overridable-behaviors composition only —
`routes: false` on both, no HTTP surface of their own), and the `@zanix/space` frontend serving the
login/2FA/password-recovery UI. Primarily a deployable application, run directly from source
(`deno task dev`/`deno task start`) or built for production (`zanix space build`) — but its
`auth-app`/`grant-access-app` manifests and its `ui/` login pages/components/SDK are also consumable
by another system directly. See [`Consuming iam`](./docs/consuming-iam.md) for the three integration
levels.

## Features

- **Sign-in**: password with an optional one-time-code (email/SMS/WhatsApp) or authenticator (TOTP)
  second factor, passwordless one-time codes, a two-step email-first sign-in, and Google/GitHub
  OAuth2. See [Authentication flows](./docs/authentication-flows.md).
- **Self-registration** on a first one-time-code or OAuth2 sign-in, closable per instance, with an
  optional default role.
- **Role administration you can trust**: grant only what you hold (decided from the caller's current
  roles, not the token), an administrator always remains, system roles are untouchable, a role with
  holders is not deleted, edits can carry the version they read, every refusal has a stable `code`,
  and every change (rejected ones too) is written to an audit trail with a configurable retention.
- **Several roles per account**: an account holds a list of roles and its permissions are their
  union; roles are added, removed or set through `/api/roles` without losing the default role.
- **Sessions**: refresh-token rotation that re-resolves permissions on every refresh.
- **Account self-service**: sign-in methods (OAuth2 link/unlink, password add/remove, TOTP, phone
  and code channel), password recovery, deactivation with confirmed reactivation, and deletion.
- **Invitations**: an account registered without a password receives a recovery code to set its own.
- **Hosted OAuth2 provider** so another host can sign its visitors in on `iam`'s pages.
- **Authorization**: an RBAC catalog resolved into each session token, plus per-resource Grant
  Access, both optionally tenant-scoped. See [Authorization](./docs/authorization.md).
- **Consumable UI and SDK**: every page and component in React and Preact, typed REST clients,
  message catalogs and a default stylesheet. See [Consuming iam](./docs/consuming-iam.md).
- **Notification templates**: in-code catalog discovery and a database-backed `/api/templates` API.
- **Cookie consent** gating session cookies on the hosted pages.

## Structure

- `mod.ts` / `space.app.ts` — the HTTP entrypoint (registers the `auth`/`grant-access` Zanix Apps
  and the `iam` space app, and starts `Zanix.start()`) and the `@zanix/space` frontend app
  definition (routes/messages/assets/global CSS), respectively. `worker.ts` is a separate entrypoint
  that starts this same project as an AsyncMQ background-jobs worker instead of an HTTP server —
  always run as its own process, never together with `mod.ts` in the same one.
- `src/server/apps/` — the `auth`/`grant-access` Zanix App manifests: resources (OAuth2 connectors,
  captcha provider), configuration, and overridable behaviors (`resolveEffectivePermissions`,
  `evaluateGrantAccess`, `passwordPolicy`, ...).
- `src/server/handlers/` — REST controllers: `LoginController` (`/login`), `PasswordController`
  (`/pwd`), `RolesController` (`/roles`), `PermissionsController` (`/permissions`),
  `UsersController` (`/users`), `GrantAccessController` (`/grant-access`), `OAuthProviderController`
  (`/oauth`, the hosted OAuth2 provider), plus `templates.handler.ts` (`/templates`,
  `@zanix/notifications`'s own controller with this project's auth guard attached). `rtos/` holds
  the request/response shapes each route validates against.
- `src/server/interactors/` — business logic: `AuthService`, `PasswordService`, `RolesService`,
  `PermissionsService`, `UsersService`, `GrantAccessService`, `OAuthProviderService`.
- `src/server/repositories/` — one folder per Mongoose-backed collection (`auth`, `users`, `roles`,
  `permissions`, `grant-access`), each with its own `model.defs.ts` (schema/attrs) and `seeders/`
  (production catalog and first administrator, plus development fixtures; see
  [Deployment](./docs/deployment.md#seeders)).
- `src/server/connectors/`, `src/server/jobs/` — starter/example files for this project's own future
  external-service connectors and AsyncMQ cron jobs (see their own doc comments for when to add a
  real one instead of using a companion package's connector).
- `src/space/routes/[lang]/` — the frontend pages: `login` (password + OAuth2 entry points),
  `login/otp/[email]`, `login/totp/[email]`, `login/[oauth]`/`login/[oauth]/callback` (OAuth2
  redirect flow, with its `error.tsx` boundary), `login/reactivate/[token]` (account reactivation),
  `totp/enroll`/`totp/confirm`, `phone/enroll`/`phone/confirm`, `password/recovery/[email]`/
  `password/recovery/callback`, `logout`, and `consent` (the cookie-consent decision endpoint).
- `src/space/middleware.ts` — registers `langPreHandler`/`langGuard`/`populationGuard` for the
  `[lang]` route segment, imported from `space.app.ts` before `getUserPreHandler()` is read back.
  `src/space/session-cookie.ts` and `src/space/comets/` hold the session-cookie presence check and
  the cookie-consent dialog.
- `src/utils/` — shared, framework-agnostic logic: `rbac.ts` (default permission-resolution
  strategy), `grant-access.ts` (default grant-evaluation strategy), `constants.ts` (env var names,
  the RBAC permission catalog, access-level ordering), `shared-enums.ts` (OAuth2 providers, OTP
  channels, second-factor methods), `oauth-provider.ts` (the hosted OAuth2 provider's client
  registry), `refresh-rate-limit-guard.ts`/`phone-confirm-rate-limit-guard.ts` (rate-limit guards
  the declarative `@RateLimitGuard` cannot express), `qr-code.ts`/`cookie-consent.ts` (TOTP QR
  generation, consent-cookie helpers).
- `src/shared/` — small primitives used across both the REST and Space surfaces (e.g.
  `redirect-response.ts`'s stateless PRG response helper), and `middlewares/` with starter
  interceptor/pipe examples.
- `ui/` — the published, consumable UI: `pages/` and `components/` (each in React and Preact),
  `sdk/` (REST clients, validation, message catalogs, session guards, login-flow helpers),
  `space/login-pages.ts` (page `loader`/`action` bodies) and `styles.ts` (the default stylesheet).
  The hosted pages under `src/space/routes/` are built from these same exports. See the
  [API reference](./docs/api-reference.md).
- `scripts/generate-compiled-messages.ts` — compiles `ui/sdk/messages/` to ICU AST
  (`deno task gen:messages`).

## Installation

To run this project itself, clone the repository and install its dependencies (to consume it FROM
another system instead — its `auth-app`/`grant-access-app` manifests, or its `ui/` login
pages/components/SDK — see [`Consuming iam`](./docs/consuming-iam.md), no clone needed):

```bash
git clone https://github.com/zanix-io/iam.git
cd iam
deno install
```

---

**Important:**

1. **Install Deno**: Ensure Deno is installed on your system. If not, follow the
   [official installation guide](https://docs.deno.com/runtime/getting_started/installation).

2. **Install VSCode Extension**: If using Visual Studio Code, install the **Deno extension** for
   syntax highlighting, IntelliSense, and linting. Get it from the
   [VSCode marketplace](https://marketplace.visualstudio.com/items?itemName=denoland.vscode-deno).

3. **Add Deno to PATH**: Ensure Deno is in your system’s `PATH` so the plugin works correctly:
   - **macOS/Linux**: Add to `.bashrc`, `.zshrc`, or other shell config files:
     ```bash
     export PATH="$PATH:/path/to/deno"
     ```
   - **Windows**: Add the Deno folder to your system’s `PATH` via Environment Variables.

---

## Environment variables

Copy [`.env.example`](./.env.example) to `.env` and fill it in before running
`deno task dev`/`deno task start`. `MONGO_URI` and the signing keys are required; every other group
is optional or enabled by its own presence. Every variable, its default and its effect is listed in
[Configuration](./docs/configuration.md).

## Basic Usage

With [`.env`](#environment-variables) configured, run in development mode:

```bash
deno task dev
```

Or build and run the production bundle:

```bash
deno task build
deno task start
```

Run as a background-jobs worker instead of an HTTP server (a separate process from the above):

```bash
deno task worker
```

Once running, the frontend serves `/{lang}/login` (password + configured OAuth2 providers), with 2FA
challenges continuing at `/{lang}/login/otp/:email` or `/{lang}/login/totp/:email`, and the REST API
is available under the `/api` prefix (see the [REST API reference](./docs/rest-api.md)).

## Documentation

- [Authentication flows](./docs/authentication-flows.md) — every sign-in and account flow end to
  end, with its security properties.
- [Authorization](./docs/authorization.md) — roles, permissions, the permission catalog, Grant
  Access and multi-tenancy.
- [REST API reference](./docs/rest-api.md) — every endpoint: auth, permission, rate limit, request,
  response and errors.
- [Configuration](./docs/configuration.md) — every environment variable and runtime config.
- [Customization](./docs/customization.md) — messages, styles and behavior overrides.
- [Deployment](./docs/deployment.md) — standalone or composed, infrastructure, a second instance,
  seeders.
- [Consuming iam](./docs/consuming-iam.md) — the three ways another system integrates with this
  service: hosted redirect, page/component import, or headless SDK.
- [API reference](./docs/api-reference.md) — every published subpath and symbol.
- [See more](./docs/see-more.md) — where each concern is implemented in the source.

## Testing

```sh
deno test --allow-all --frozen
```

runs the unit and integration suites, which need no services, and skips the end-to-end scenarios.
Those (`src/@tests/functional/e2e/`) start the real server as a child process on a throw-away
database and call it over HTTP with tokens issued by its own login, so they need a MongoDB they may
write to:

```sh
IAM_TEST_MONGO_URI=mongodb://127.0.0.1:27017 deno test --allow-all --frozen
```

Without `IAM_TEST_MONGO_URI` they are skipped. The migration scenario also needs `mongosh` on the
`PATH` (it runs the commands of the CHANGELOG exactly as written) and is skipped without it.

What the scenarios guarantee, so they can run against a machine that holds real data: each server
gets its own database named `znx_iam_test_<random>`, created by the run and dropped when it ends
(the harness refuses any other name, and never names `zanix_iam` or any other database); a random
port and random JWT and data keys that are never printed; a clean environment, so nothing from a
developer's `.env` reaches it; its own copy of `deno.lock`, so the repository's is never modified;
and no Redis (the server uses its in-memory fallback, so there are no keys to namespace or clean).
Every server is stopped in a `finally`, and a run that is killed leaves at most a `znx_iam_test_*`
database behind, which `db.getMongo().getDBNames()` shows.

## Contributing

If you'd like to contribute to the project, follow these steps:

1. **Report Issues**: If you find any bugs or have suggestions, open an issue on the GitHub
   repository.
2. **Fork the Repo**: Fork the project and create a branch for your changes.
3. **Make Changes**: Develop new features or fix bugs while adhering to the project’s coding
   guidelines.
4. **Submit a Pull Request**: Once your changes are ready, submit a pull request with a clear
   description of what you’ve done.

## Changelog

For a detailed list of changes, refer to the [CHANGELOG](./CHANGELOG.md).

## License

This project is licensed under the **MIT License**. See the [LICENSE](./LICENSE) file for more
details.

## Resources

- [Deno](https://docs.deno.com/) — the runtime this project runs on.
- [`@zanix/server`](https://jsr.io/@zanix/server) — the REST framework the `auth`/`grant-access`
  domain slices are built on.
- [`@zanix/space`](https://jsr.io/@zanix/space) — the frontend framework serving the login/2FA/
  password-recovery UI.
- [`@zanix/auth`](https://jsr.io/@zanix/auth) — session issuing, OTP/TOTP, OAuth2 connectors, and
  captcha/rate-limit guards.
- [`@zanix/notifications`](https://jsr.io/@zanix/notifications) — the notifier this project
  dispatches OTP/recovery/welcome/password-changed messages through.
