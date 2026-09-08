## See More

Deeper implementation notes for this project's own domain logic, organized by concern. Each section
links straight to the source file that owns the authoritative doc comment — this guide doesn't
restate that prose, only maps where to find it.

### Login and sessions

- Password login, OTP/TOTP challenge dispatch, and OAuth2 (Google/GitHub) login all live on
  [`AuthService`](../src/server/interactors/auth.interactor.ts) — see its own per-method doc for
  exactly which `HttpError` status each path throws and why.
- Refresh-token rotation re-resolves the account's current permissions on every refresh
  (`AuthService.refreshTokens`), so a role reassignment takes effect on the very next refresh
  without a forced re-login — see that method's own doc for the reuse-detection/grace-window
  mechanism this relies on.
- Password change/recovery and passwordless account invites live on
  [`PasswordService`](../src/server/interactors/password.interactor.ts).
- TOTP enrollment/confirmation (`AuthService.totpEnroll`/`totpConfirm`) and QR-code generation
  ([`utils/qr-code.ts`](../src/utils/qr-code.ts)) are split so enrollment never persists a secret
  before the user's authenticator app actually proves it holds it.

### RBAC (roles and permissions)

- [`utils/rbac.ts`](../src/utils/rbac.ts) — `resolveEffectivePermissions`, the default strategy
  flattening a role's active permissions into the code list embedded into a session token. `roles`
  and `permissions` stay two separate collections; see
  [`repositories/roles/model.defs.ts`](../src/server/repositories/roles/model.defs.ts) for how
  `permissions` are referenced and what "multi-tenancy" means for this catalog.
- The evaluation strategy is registered as `auth.app.ts`'s own `resolveEffectivePermissions`
  behavior default, overridable per host without forking `AuthService` — see
  [`server/apps/auth.app.ts`](../src/server/apps/auth.app.ts) for the override mechanism.
- The full permission-code catalog gating every admin endpoint is
  [`utils/constants.ts`](../src/utils/constants.ts)'s `RBAC_PERMISSIONS`.

### Grant Access

- [`utils/grant-access.ts`](../src/utils/grant-access.ts) — `defaultEvaluateGrantAccess`, the
  default `READ`/`WRITE`/`MANAGE` ordering strategy, overridable per host the same way
  `resolveEffectivePermissions` is (`grant-access.app.ts`'s own `evaluateGrantAccess` behavior).
- Independent from the RBAC catalog by design — see
  [`GrantAccessService`](../src/server/interactors/grant-access.interactor.ts)'s own doc for why its
  admin endpoints reuse `RBAC_PERMISSIONS` instead of a parallel authorization mechanism.

### Users

- [`UsersService`](../src/server/interactors/users.interactor.ts) — self-service profile access and
  administrative registration/editing. A profile is always reached FROM its `auth` record via
  `AuthenticationAttrs.userId`, never the reverse — see
  [`repositories/users/model.defs.ts`](../src/server/repositories/users/model.defs.ts) for why the
  two collections stay separate.

### Frontend (`@zanix/space`)

- Every session-issuing page under `src/space/routes/[lang]/` (see
  [`login/page.tsx`](../src/space/routes/[lang]/login/page.tsx)) binds directly to the matching
  interactor (`AuthService`/`PasswordService`) through a normal `@Page({ Interactor })` action — see
  that file's own doc for the full account of how session cookies get written with no bespoke
  per-page cookie handling.
- [`space/session-cookie.ts`](../src/space/session-cookie.ts) — the presence-only cookie check pages
  use to redirect an already-signed-in request away from the login form; never a substitute for a
  real guard.
- [`space/comets/cookie-consent-modal.comet.tsx`](../src/space/comets/cookie-consent-modal.comet.tsx)
  — the project-wide consent dialog composed once in the root `[lang]/layout.tsx`; see
  [`utils/constants.ts`](../src/utils/constants.ts)'s `COOKIE_CONSENT_ENABLED_ENV` doc for how to
  opt out when a deployment already obtains consent another way.

### Notification templates

- [`server/handlers/templates.handler.ts`](../src/server/handlers/templates.handler.ts) — the
  `/templates` CRUD API (`@zanix/notifications`'s own controller with this project's auth guard
  attached), active once `TEMPLATES_BACKEND=local` is set (see [`.env.example`](../.env.example)).
- `mod.ts`'s `codeTemplatesDiscovery: true` exposes this project's in-code template catalog under
  `/.well-known/zanix/code-templates`, so a central console can pull/seed its aggregated catalog
  from this service.
