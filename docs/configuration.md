## Configuration

Every environment variable `iam` reads, directly or through the Zanix packages it runs on, and the
runtime configs and behaviors its App manifests declare. [`.env.example`](../.env.example) is the
copyable template; this page is the reference.

`deno task start` (the HTTP process, `mod.ts`) and `deno task worker` (the background-jobs process,
`worker.ts`) both load `.env` with `--env-file=.env`. Variables marked "boot" are read once when the
module loads, so a change needs a restart.

### Contents

- [Instance](#instance)
- [Database and cache](#database-and-cache)
- [Signing keys and data encryption](#signing-keys-and-data-encryption)
- [Sessions](#sessions)
- [Rate limits](#rate-limits)
- [Sign-up and first administrator](#sign-up-and-first-administrator)
- [Audit and administration limits](#audit-and-administration-limits)
- [OAuth2 providers](#oauth2-providers)
- [Hosted OAuth2 provider clients](#hosted-oauth2-provider-clients)
- [Captcha](#captcha)
- [Notifications](#notifications)
- [Hosted pages](#hosted-pages)
- [Runtime configs](#runtime-configs)
- [Behaviors](#behaviors)
- [See also](#see-also)

### Instance

| Variable     | Default           | Effect                                                                                                                                                                                                                             | Read by                         |
| ------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `SERVICE_ID` | `zanix-iam`       | This instance's identity: the prefix of every permission code (`<SERVICE_ID>:role-read`, ...), the TOTP issuer, and the service name in emails. Letters and hyphens only; any other value throws `IAM_INVALID_SERVICE_ID` at boot. | `src/utils/constants.ts` (boot) |
| `ENV`        | unset             | `production` skips the development seeders (a `superadmin` account `dev@<SERVICE_ID>.local` with a known password). Any other value runs them. See [Deployment](./deployment.md#seeders).                                          | `src/utils/seeders.ts` (boot)   |
| `PORT`       | `8000`            | Port of the REST server.                                                                                                                                                                                                           | `@zanix/server`                 |
| `PORT_SSR`   | framework default | Port of the frontend (`@zanix/space`) server.                                                                                                                                                                                      | `@zanix/server`                 |

### Database and cache

| Variable        | Default                                     | Effect                                                                                                                                                 | Read by                           |
| --------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `MONGO_URI`     | none (required)                             | MongoDB connection URI.                                                                                                                                | `@zanix/datamaster`               |
| `MONGO_DB_NAME` | derived from `deno.json` name (`zanix_iam`) | Database name. Set a different one to run a second instance with its own accounts, roles and sessions. Needs `@zanix/datamaster >= 1.11.1`.            | `@zanix/datamaster`               |
| `REDIS_URI`     | unset (in-memory cache)                     | Redis connection. Needed for refresh-token reuse detection, one-time codes and rate-limit counters shared across replicas; omit for a single instance. | `@zanix/datamaster`/`@zanix/auth` |

### Signing keys and data encryption

| Variable                          | Default | Effect                                                                                                                                                  | Read by                                                                                   |
| --------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `JWT_KEY`                         | none    | HMAC key for `user` session tokens; also signs the reactivation token and the hosted-provider authorization code. Missing answers `500` on those paths. | `@zanix/auth`, `src/server/interactors/auth.interactor.ts`, `src/utils/oauth-provider.ts` |
| `JWK_PRI`, `JWK_PUB`              | none    | RSA key pair (base64 PKCS#8 / SPKI) for `api` tokens.                                                                                                   | `@zanix/auth`                                                                             |
| `JWK_ROTATION_CYCLE`              | unset   | Rotation period (e.g. `30m`), effective only with versioned keys (`_V1`, `_V2`, ...).                                                                   | `@zanix/auth`                                                                             |
| `DATA_SECRET_KEY`, `DATA_AES_KEY` | none    | Keys for field protection: hashing and encryption of `password`, `oauthRefreshToken`, `totpSecret` and `phone`.                                         | `@zanix/datamaster`                                                                       |

### Sessions

| Variable                   | Default              | Effect                                                                                                                                                                              | Read by                                                                          |
| -------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `ACCESS_TOKEN_EXPIRATION`  | `1h` (`@zanix/auth`) | Access-token lifetime, as a duration (`30m`) or seconds (`1800`). At most `1h`; a longer value fails at the next sign-in. The `expiresAt` in responses is computed from it at boot. | `src/utils/constants.ts` (issued lifetime read per sign-in; `expiresAt` at boot) |
| `REFRESH_TOKEN_EXPIRATION` | `1y` (`@zanix/auth`) | Refresh-token lifetime, same format. Must be at least 3 times the access-token lifetime; otherwise the next sign-in fails.                                                          | `src/utils/constants.ts`                                                         |

### Rate limits

Tiers per endpoint are listed in the [REST API reference](./rest-api.md#conventions).

| Variable                    | Default | Effect                                                                                                                                                 | Read by                         |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| `FREE_RATELIMIT`            | `3`     | `freeRateLimit`: password login, code callbacks, reactivation, recovery callback, phone confirmation, hosted-provider token exchange.                  | `src/utils/constants.ts` (boot) |
| `CRITICAL_RATELIMIT`        | `1`     | `criticalRateLimit`: one-time-code dispatch, recovery dispatch, OAuth2 start, refresh, hosted-provider authorize.                                      | `src/utils/constants.ts` (boot) |
| `LOGIN_METHODS_RATELIMIT`   | `2`     | `loginMethodsRateLimit`: `GET /api/login/methods/:email`, which a two-step sign-in calls twice per attempt (browser lookup, then the server `action`). | `src/utils/constants.ts` (boot) |
| `RATE_LIMIT_WINDOW_SECONDS` | `60`    | The window every limit counts over.                                                                                                                    | `@zanix/auth`                   |
| `RATE_LIMIT_PLANS`          | unset   | `index:max` plans (e.g. `0:100;1:1000`); a session's `rateLimit` then selects a plan instead of being the limit itself.                                | `@zanix/auth`                   |

### Sign-up and first administrator

| Variable               | Default | Effect                                                                                                                                                                                                                       | Read by                                                        |
| ---------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `SELF_REGISTRATION`    | open    | `false` closes self-registration: sets the default of the `selfRegistrationViaOTP` and `selfRegistrationViaOAuth` configs. Any other value, or unset, keeps both open.                                                       | `src/utils/constants.ts` (boot)                                |
| `DEFAULT_ROLE_ID`      | unset   | `roles.id` given to an account created by self-registration (default of the `defaultRoleId` config). It is the account's first role and later roles are added after it. Unset, a new account has no role and no permissions. | `src/utils/constants.ts` (boot)                                |
| `FIRST_ADMIN_EMAIL`    | unset   | With `FIRST_ADMIN_PASSWORD`, seeds one account holding the `superadmin` role on boot, once. Both must be set.                                                                                                                | `src/server/repositories/{auth,users}/seeders/seeders.prod.ts` |
| `FIRST_ADMIN_PASSWORD` | unset   | That account's password (hashed on insert).                                                                                                                                                                                  | same                                                           |

### Audit and administration limits

| Variable                                  | Default | Effect                                                                                                                                                                                                       | Read by                         |
| ----------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| `AUDIT_RETENTION_DAYS`                    | `365`   | Days an audit event (`role_audit_events`) is kept before MongoDB's TTL monitor deletes it. A positive integer; anything else is the default. It sets the `expireAfterSeconds` of the collection's TTL index. | `src/utils/constants.ts` (boot) |
| `ADMIN_MUTATION_RATELIMIT`                | `30`    | Requests per window one operator (one account, across all its tokens) may make to the administration mutations (roles, permissions, `PATCH /api/users/:id`), counted in one bucket of their own.             | `src/utils/constants.ts` (boot) |
| `ADMIN_MUTATION_RATELIMIT_WINDOW_SECONDS` | `60`    | The window of `ADMIN_MUTATION_RATELIMIT`.                                                                                                                                                                    | `src/utils/constants.ts` (boot) |

`ADMIN_MUTATION_RATELIMIT` and its window must be positive integers: a value that is set and is not
(`-5`, `0`, `1.5`, `abc`) stops the boot (`IAM_INVALID_POSITIVE_INTEGER_ENV`) instead of being
absorbed; unset or empty is the default. An administration mutation spends from **two** buckets: the
session's own (the limit of its plan, `session.rateLimit`, counted per access token by the token
validation) and the operator's (`ADMIN_MUTATION_RATELIMIT`, counted per account). Whichever runs out
first answers `429`, so a figure above the plan limit of the tokens is in practice capped by that
limit, per token.

Changing `AUDIT_RETENTION_DAYS` on an existing database does not change the index MongoDB already
has, and a mismatch makes the index build fail at boot. Update it in place with `collMod`
(`<seconds>` is days times 86400):

```js
db.runCommand({
  collMod: 'role_audit_events',
  index: { keyPattern: { createdAt: 1 }, expireAfterSeconds: <seconds> },
})
```

The upgrade from 1.x changes stored data (`roleId` becomes `roleIds`, `superadmin` becomes a system
role at startup, `role_audit_events` is new): follow "Upgrading from 1.x" in the
[CHANGELOG](../CHANGELOG.md) before starting the new version.

The audit trail is read with `GET /api/audit`, which needs the `audit-read` permission (seeded, also
in a database that came from 1.x; give it through a role). See
[Authorization](./authorization.md#audit-trail).

### OAuth2 providers

A provider is enabled when its `*_CLIENT_ID` is present; set all three of its variables.

| Variables                                                                              | Effect                                                             | Read by                              |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------ |
| `GOOGLE_OAUTH2_CLIENT_ID`, `GOOGLE_OAUTH2_CLIENT_SECRET`, `GOOGLE_OAUTH2_REDIRECT_URI` | Google sign-in (`googleOAuth2` resource, authorization-code flow). | `src/server/apps/auth.app.ts` (boot) |
| `GITHUB_OAUTH2_CLIENT_ID`, `GITHUB_OAUTH2_CLIENT_SECRET`, `GITHUB_OAUTH2_REDIRECT_URI` | GitHub sign-in (`githubOAuth2` resource).                          | `src/server/apps/auth.app.ts` (boot) |

### Hosted OAuth2 provider clients

| Variable                 | Default | Effect                                                                                                                                                                                                                  | Read by                       |
| ------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `OAUTH_PROVIDER_CLIENTS` | unset   | JSON array of `{ "clientId", "clientSecret", "redirectUris": [...] }`: the hosts allowed to use `/api/oauth/authorize` and `/api/oauth/token`. Unset, every authorize request is rejected. Malformed JSON fails loudly. | `src/utils/oauth-provider.ts` |

### Captcha

Guards `POST /api/login/login` and `GET /api/pwd/recovery/:email` once a provider is configured.

| Variable                                                                | Effect                                                                    | Read by       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------- |
| `RECAPTCHA_SECRET_KEY` / `HCAPTCHA_SECRET_KEY` / `TURNSTILE_SECRET_KEY` | Setting one enables that provider.                                        | `@zanix/auth` |
| `CAPTCHA_PROVIDER`                                                      | `recaptcha`, `hcaptcha` or `turnstile`, when more than one secret is set. | `@zanix/auth` |

### Notifications

One-time codes, recovery codes and account emails (`welcome`, `password-changed`, `totp-enabled`)
are sent through `@zanix/notifications`. Each channel registers only when its variables are set.

| Variables                                                       | Channel                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`          | Email (required for email codes and recovery).                                                                                                                                                                                                                                                                                                                             |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | SMS through Twilio.                                                                                                                                                                                                                                                                                                                                                        |
| `VONAGE_API_KEY`, `VONAGE_API_SECRET`, `VONAGE_FROM`            | SMS through Vonage.                                                                                                                                                                                                                                                                                                                                                        |
| `SMS_PROVIDER`                                                  | Chooses the SMS provider when both are configured.                                                                                                                                                                                                                                                                                                                         |
| `META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN`                     | WhatsApp through Meta.                                                                                                                                                                                                                                                                                                                                                     |
| `TWILIO_WHATSAPP_FROM` (with the Twilio credentials)            | WhatsApp through Twilio.                                                                                                                                                                                                                                                                                                                                                   |
| `WHATSAPP_PROVIDER`                                             | Chooses the WhatsApp provider when both are configured.                                                                                                                                                                                                                                                                                                                    |
| `TEMPLATES_BACKEND`                                             | `local` stores templates in the database, making them editable through `/api/templates` and seeding the `totp-enabled` template at boot (the account-security notice that confirms TOTP is enabled is sent only then). Unset, templates render from code, nothing is seeded, the server starts normally and `/api/templates` answers `404` (`TEMPLATES_BACKEND_DISABLED`). |

### Hosted pages

| Variable                   | Default | Effect                                                                                                                                                                                                          | Read by                                             |
| -------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `POST_LOGIN_REDIRECT_URL`  | `/`     | Where a successful sign-in, second-factor check or recovery lands when the request has no safe `redirect_to`.                                                                                                   | `src/utils/constants.ts` (per request)              |
| `TRUSTED_REDIRECT_ORIGINS` | unset   | Comma-separated origins a `redirect_to` may point at absolutely (e.g. `https://app.example.com`). Unset, only same-origin relative paths are accepted.                                                          | `src/utils/constants.ts` (per request)              |
| `COOKIE_CONSENT_ENABLED`   | on      | `false` removes the cookie-consent dialog and marks every request as consented, so session cookies are still delivered. Use it when consent is obtained elsewhere.                                              | `src/utils/constants.ts`, `src/space/middleware.ts` |
| `TERMS_AND_CONDITIONS_URL` | unset   | Shows a Terms and Conditions link on the login page.                                                                                                                                                            | `src/space/routes/[lang]/login/page.tsx`            |
| `PRIVACY_NOTICE_URL`       | unset   | Shows a Privacy Notice link on the login page, independently of the terms link.                                                                                                                                 | `src/space/routes/[lang]/login/page.tsx`            |
| `IAM_THEME`                | unset   | JSON object of `--space-*` token overrides applied to every page (`space.app.ts`'s `theme.resolve`). Malformed JSON fails the request with `IAM_INVALID_THEME`. See [Customization](./customization.md#styles). | `src/utils/constants.ts` (per request)              |
| `IAM_MESSAGES`             | unset   | JSON object of message-key overrides merged over the catalog in the `[lang]` layout. Malformed JSON fails with `IAM_INVALID_MESSAGES`. See [Customization](./customization.md#messages).                        | `src/utils/constants.ts` (per request)              |

### Runtime configs

Declared in `config` of the [`auth` manifest](../src/server/apps/auth.app.ts) and read with
`resolveConfig('auth', key)`. A config resolves to a host override when one exists, else to the
declared default. Overrides reach a running app through the `@zanix/app` Config Plane, which applies
to an app running in `remote` mode; `Zanix.start()`'s `apps` entries accept `behaviors` overrides
but no `config` overrides. In an embedded deployment, set the defaults through the env vars in the
table.

| Config                     | Type    | Default                         | Effect                                                                                       |
| -------------------------- | ------- | ------------------------------- | -------------------------------------------------------------------------------------------- |
| `selfRegistrationViaOTP`   | boolean | `SELF_REGISTRATION !== 'false'` | Whether an email one-time code for an unknown email creates an account.                      |
| `selfRegistrationViaOAuth` | boolean | `SELF_REGISTRATION !== 'false'` | Whether a first OAuth2 sign-in for an unknown email creates an account.                      |
| `defaultRoleId`            | string  | `DEFAULT_ROLE_ID` or `''`       | Role given to a self-registered account; `''` means none.                                    |
| `totpToleranceSteps`       | number  | `1`                             | 30-second steps before and after the current one in which an authenticator code is accepted. |

### Behaviors

Function slots (`passwordPolicy`, `totpProvisioningLabel`, `resolveEffectivePermissions`,
`evaluateGrantAccess`, `loginHeading`) are overridden in code through `Zanix.start()`, not through
the environment; see [Customization](./customization.md#behaviors).

### See also

- [Deployment](./deployment.md)
- [REST API reference](./rest-api.md)
- [Customization](./customization.md)
- [README](../README.md)
