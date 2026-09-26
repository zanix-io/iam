## Deployment

How to run `iam`: as a standalone service, or with its App manifests composed into another Zanix
process, what infrastructure it needs, how to run a second instance, and what the seeders create.
Every variable mentioned is described in [Configuration](./configuration.md).

### Contents

- [Standalone service](#standalone-service)
- [Composing the manifests](#composing-the-manifests)
- [Infrastructure](#infrastructure)
- [A second instance](#a-second-instance)
- [Seeders](#seeders)
- [See also](#see-also)

### Standalone service

The normal deployment: one process started from `mod.ts` serves

- the REST API under `/api` (every controller in `src/server/handlers/`, auto-discovered from the
  project root; see the [REST API reference](./rest-api.md));
- the `auth` and `grant-access` Zanix Apps (config, resources, behaviors and operations; no routes
  of their own);
- the `iam` `@zanix/space` app ([`space.app.ts`](../space.app.ts)): the hosted pages under
  `/{lang}/...`, its assets and the default stylesheet. Its own REST route (`POST /iam-space/log`)
  uses the `iam-space` prefix so it never collides with the `/api` controllers;
- `GET /.well-known/zanix/code-templates` (`codeTemplatesDiscovery: true`).

| Command            | What it does                                                                   |
| ------------------ | ------------------------------------------------------------------------------ |
| `deno task dev`    | Installs dependencies and runs `zanix space dev` (development server).         |
| `deno task build`  | `zanix space build`: builds the frontend into `.dist/`.                        |
| `deno task start`  | Runs `mod.ts` with `--env-file=.env` (production).                             |
| `deno task worker` | Runs `worker.ts` (`Zanix.startWorker()`): the AsyncMQ background-jobs process. |

Run the worker as its own process, never in the same one as `mod.ts`. Behind a load balancer, put a
trusted reverse proxy in front: anonymous rate limits key on the client IP from proxy headers.

### Composing the manifests

`@zanix/iam/auth-app` and `@zanix/iam/grant-access-app` export the two App manifests for another
process's `Zanix.start()`:

```ts
import Zanix from '@zanix/core'
import authApp from '@zanix/iam/auth-app'
import grantAccessApp from '@zanix/iam/grant-access-app'

await Zanix.start({
  apps: {
    [authApp.definition.name]: { definition: authApp, behaviors: {/* overrides */} },
    [grantAccessApp.definition.name]: { definition: grantAccessApp },
  },
})
```

What a manifest carries: the `auth` app's OAuth2 and captcha resources (registered from the env
vars), its runtime configs and behaviors, and the `totp-enabled` template seeding in `setup`; the
`grant-access` app's `evaluateGrantAccess` behavior and `checkAccess` operation. Both declare
`routes: false`: the REST controllers, interactors, repositories and hosted pages are not part of
the manifests and are served only by the standalone service. Behavior overrides are described in
[Customization](./customization.md#behaviors).

### Infrastructure

| Dependency               | Required                     | Used for                                                                                                                                                             |
| ------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MongoDB (`MONGO_URI`)    | Yes                          | Collections `auth`, `users`, `roles`, `permissions`, `grant_accesses`, and templates with `TEMPLATES_BACKEND=local`.                                                 |
| Redis (`REDIS_URI`)      | For more than one replica    | Refresh-token reuse detection, one-time codes, rate-limit counters and the hosted-provider code blocklist shared across replicas. Without it the cache is in memory. |
| SMTP (`SMTP_*`)          | For email codes and messages | One-time codes, recovery codes, `welcome`, `password-changed` and `totp-enabled` emails.                                                                             |
| SMS / WhatsApp providers | Optional                     | Phone verification (SMS) and the `sms`/`whatsapp` login-code channels.                                                                                               |
| Captcha provider         | Optional                     | `POST /api/login/login` and `GET /api/pwd/recovery/:email`.                                                                                                          |
| Signing and data keys    | Yes                          | `JWT_KEY`, `JWK_PRI`, `JWK_PUB` for tokens; `DATA_SECRET_KEY`, `DATA_AES_KEY` for protected fields.                                                                  |

Every service that verifies an `iam` token needs the same signing keys.

### A second instance

Accounts that must stay separate, such as a staff console or a partner portal whose accounts an
administrator creates, run as a second instance of the same code with its own env file.
[`.env.staff.example`](../.env.staff.example) is the template: copy it to `.env.staff` and run the
instance with only that file.

| Setting                                                       | Why                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `ENV='production'`                                            | Skips the development seeders.                                            |
| `SERVICE_ID='iam-staff'`                                      | Its own permission prefix, TOTP issuer and email copy.                    |
| `MONGO_DB_NAME='iam_staff'`                                   | Its own accounts, roles and sessions (same or another MongoDB server).    |
| `SELF_REGISTRATION='false'`                                   | Accounts are created by an administrator, never by signing in.            |
| `PORT`, `PORT_SSR`                                            | Different ports from the main instance.                                   |
| `FIRST_ADMIN_EMAIL`, `FIRST_ADMIN_PASSWORD`                   | Seeds the first `superadmin`, who then registers staff and assigns roles. |
| The main instance's `JWT_KEY`, `JWK_PRI`, `JWK_PUB`, `DATA_*` | Services that receive a staff token verify it with the same keys.         |
| `SMTP_*`, `TEMPLATES_BACKEND`                                 | Code delivery.                                                            |

Because `SERVICE_ID` differs, the staff instance's permission codes (`iam-staff:role-read`, ...)
never match the main instance's.

### Seeders

Each collection registers seeders that run on boot and insert fixed-id documents only when missing
([`utils/seeders.ts`](../src/utils/seeders.ts)).

Always (production):

- the permissions `*`, `<SERVICE_ID>:role-read`, `role-write`, `permission-read`,
  `permission-write`, `user-read` and `user-write`;
- the role `superadmin`, holding `*`;
- with `FIRST_ADMIN_EMAIL` and `FIRST_ADMIN_PASSWORD` both set: the first administrator (profile and
  sign-in record with the `superadmin` role).

Unless `ENV=production`: a profile "Dev User" and a sign-in record `dev@<SERVICE_ID>.local` with the
password `DevPass123!` and the `superadmin` role. Always set `ENV=production` in production.

See [Authorization](./authorization.md#seeded-data-and-the-first-administrator) for what the seeded
catalog grants.

### See also

- [Configuration](./configuration.md)
- [Authorization](./authorization.md)
- [Consuming iam](./consuming-iam.md)
- [README](../README.md)
