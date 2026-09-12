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
8. [Contributing](#contributing)
9. [Changelog](#changelog)
10. [License](#license)
11. [Resources](#resources)

## Description

An identity service built on `@zanix/server`/`@zanix/space`/`@zanix/auth`: multi-user
password/OTP/TOTP/OAuth2 login, refresh-token session management, and an RBAC catalog
(roles/permissions) plus fine-grained per-resource access grants. `Zanix.start()` activates four
named apps from one process (`mod.ts`): the project's own REST controllers (auto-discovered from the
project root, covering both the `auth` and `grant-access` domain slices), the `auth` and
`grant-access` Zanix Apps themselves (configuration/resources/overridable-behaviors composition only
— `routes: false` on both, no HTTP surface of their own), and the `@zanix/space` frontend serving
the real login/2FA/password-recovery UI. Primarily a deployable application, run directly from
source (`deno task dev`/`deno task start`) or built for production (`zanix space build`) — but its
`auth-app`/`grant-access-app` manifests and its `ui/` login pages/components/SDK are also consumable
by another system directly. See [`Consuming iam`](./docs/consuming-iam.md) for the three integration
levels.

## Features

- **Password login** with optional OTP (email/SMS/WhatsApp) or TOTP (authenticator app) 2FA
  challenge, and OAuth2 login (Google, GitHub — each enabled by setting its client
  id/secret/redirect URI).
- **Refresh-token session rotation** via `@zanix/auth`'s `session.refreshTokens()`, re-resolving the
  account's current permissions on every refresh so a role reassignment takes effect on the very
  next refresh, without a forced re-login.
- **Password recovery** and **passwordless account invites**: a profile registered without a
  password is sent straight into the recovery flow to set its own credential, instead of an admin
  choosing one.
- **RBAC catalog** (`roles`/`permissions`) — a role bundles a set of permission codes; a session's
  effective permissions are flattened into its token's `aud` claim at login. The evaluation strategy
  (`resolveEffectivePermissions`, `auth.app.ts`) is overridable per host without forking
  `AuthService`.
- **Grant Access** — fine-grained, per-resource access grants (`READ`/`WRITE`/`MANAGE`, optionally
  tenant-scoped), independent from the RBAC catalog and gated by its own
  `RBAC_PERMISSIONS.grantAccessRead`/`grantAccessWrite` permissions rather than a parallel
  authorization mechanism.
- **Users** — profile registration/self-service/admin management, kept as a collection separate from
  `auth` (credentials/session state), always reached from `auth.userId`.
- **Multi-tenancy** — SaaS-shaped, not multi-product: this deployment serves ONE product, and
  `roles`/`grant-access` records may optionally carry a `tenantId` for per-customer/organization
  scoping within it.
- **Notification-template discovery** — exposes this project's in-code notification-template catalog
  under `/.well-known/zanix/code-templates` (`codeTemplatesDiscovery: true`, `mod.ts`), and (with
  `TEMPLATES_BACKEND=local`) a `/templates` CRUD API over database-backed template overrides.
- **Cookie consent** — a project-wide consent dialog (composed once in the root layout) gates every
  session-issuing page equally; declining still lets the app work, it just means no session cookie
  is emitted until accepted.

## Structure

- `mod.ts` / `space.app.ts` — the HTTP entrypoint (registers the `auth`/`grant-access`/`iam` Zanix
  Apps and starts `Zanix.start()`) and the `@zanix/space` frontend app definition
  (routes/messages/assets/global CSS), respectively. `worker.ts` is a separate entrypoint that
  starts this same project as an AsyncMQ background-jobs worker instead of an HTTP server — always
  run as its own process, never together with `mod.ts` in the same one.
- `src/server/apps/` — the `auth`/`grant-access` Zanix App manifests: resources (OAuth2 connectors,
  captcha provider), configuration, and overridable behaviors (`resolveEffectivePermissions`,
  `evaluateGrantAccess`, `passwordPolicy`, ...).
- `src/server/handlers/` — REST controllers: `LoginController` (`/login`), `PasswordController`
  (`/pwd`), `RolesController` (`/roles`), `PermissionsController` (`/permissions`),
  `UsersController` (`/users`), `GrantAccessController` (`/grant-access`), plus
  `templates.handler.ts` (`/templates`, `@zanix/notifications`'s own controller with this project's
  auth guard attached). `rtos/` holds the request/response shapes each route validates against.
- `src/server/interactors/` — business logic: `AuthService`, `PasswordService`, `RolesService`,
  `PermissionsService`, `UsersService`, `GrantAccessService`.
- `src/server/repositories/` — one folder per Mongoose-backed collection (`auth`, `users`, `roles`,
  `permissions`, `grant-access`), each with its own `model.defs.ts` (schema/attrs) and `seeders/`
  (dev-only fixtures plus any production data migrations).
- `src/server/connectors/`, `src/server/jobs/` — starter/example files for this project's own future
  external-service connectors and AsyncMQ cron jobs (see their own doc comments for when to add a
  real one instead of using a companion package's connector).
- `src/space/routes/[lang]/` — the frontend pages: `login` (password + OAuth2 entry points),
  `login/otp/[email]`, `login/totp/[email]`, `login/[oauth]`/`login/[oauth]/callback` (OAuth2
  redirect flow), `totp/enroll`/`totp/confirm`, `password/recovery/[email]`/
  `password/recovery/callback`, `logout`, and `consent` (the cookie-consent decision endpoint).
- `src/space/middleware.ts` — registers `langPreHandler`/`langGuard`/`populationGuard` for the
  `[lang]` route segment, imported from `space.app.ts` before `getUserPreHandler()` is read back.
- `src/utils/` — shared, framework-agnostic logic: `rbac.ts` (default permission-resolution
  strategy), `grant-access.ts` (default grant-evaluation strategy), `constants.ts` (env var names,
  the RBAC permission catalog, access-level ordering), `qr-code.ts`/`cookie-consent.ts` (TOTP QR
  generation, consent-cookie helpers).
- `src/shared/` — small primitives used across both the REST and Space surfaces (e.g.
  `redirect-response.ts`'s stateless PRG response helper).

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

Copy [`.env.example`](./.env.example) to `.env` and fill in real values before running
`deno task dev`/`deno task start` — that file documents every variable this project reads, grouped
by concern: database/cache, JWT signing keys, OAuth2 providers (Google/GitHub — both optional, each
enabled by setting its full client id/secret/redirect-URI triplet), captcha, anonymous rate limits,
session-token lifetimes, notification delivery (SMTP/SMS/WhatsApp), data-field encryption, and
cookie-consent/terms-and-conditions display.

`MONGO_URI` is the only variable `.env.example` marks as unconditionally required; every other group
is either optional with a documented default (rate limits, session-token lifetimes, cookie consent)
or feature-gated by its own presence (OAuth2 providers, captcha, SMS/WhatsApp delivery).

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
is available under `/login`, `/pwd`, `/roles`, `/permissions`, `/users`, `/grant-access`, and
`/templates`.

## Documentation

For additional information, see:

- [`See more`](./docs/see-more.md) — deeper implementation notes and links into the source's own doc
  comments, organized by domain slice.
- [`Consuming iam`](./docs/consuming-iam.md) — the three ways another system can integrate with this
  service (a zero-code hosted login redirect, importing the real login pages/components directly in
  React or Preact, or a headless SDK for any framework), plus backend-only auth/grant-access
  composition.

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
