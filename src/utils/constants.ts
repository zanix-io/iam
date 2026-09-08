/**
 * Shared constants for the `auth` domain slice (and, by convention, for every future domain
 * slice added to this project — `roles`/`permissions`/`users`/`grant-access`).
 */

import { parseTTL } from '@zanix/helpers'

/** OAuth2 providers this project wires (see `zanix-iam`'s `auth` app manifest resources). */
export const OAUTH_PROVIDERS = ['google', 'github'] as const

/**
 * Delivery channels `@zanix/auth`'s OTP mechanism can dispatch a one-time code through — matches
 * `@zanix/notifications`'s own `Notifiers` union exactly, so every value here is a real,
 * independently-registerable channel (`SmtpClient`/`SmsClient`/`WhatsappClient`), not aspirational.
 */
export const NOTIFIERS = ['email', 'sms', 'whatsapp'] as const

/**
 * Every supported second-factor method — the delivery-based `NOTIFIERS` (OTP) plus the
 * authenticator-app method (`'totp'`, no delivery involved — the code is generated locally on
 * the user's device from a shared secret).
 */
export const TWO_FACTOR_METHODS = [...NOTIFIERS, 'totp'] as const

/** Which login actions can require a second factor (see `AuthenticationAttrs.twoFactorAuthConfig`). */
export const LOGIN_ACTIONS = ['login', 'refresh'] as const

/**
 * Env var name for the access token's lifetime issued on login (see `AuthService.finishLogin`),
 * as a human-readable duration (`'30m'`, `'1h'`) or a bare number of seconds — the same format
 * `@zanix/auth`'s own `AuthSessionOptions.accessExpiration` accepts. Unset keeps today's behavior:
 * `@zanix/auth`'s own `'1h'` default. `@zanix/auth`'s `createAccessToken` enforces a hard 1-hour
 * ceiling on whatever this resolves to — a longer value throws an `InternalError` at the next
 * login, not at boot, so a misconfiguration here surfaces as a real login failure.
 */
export const ACCESS_TOKEN_EXPIRATION_ENV = 'ACCESS_TOKEN_EXPIRATION'

/**
 * Env var name for the refresh token's lifetime issued on login — same format as
 * {@linkcode ACCESS_TOKEN_EXPIRATION_ENV}. Unset keeps today's behavior: `@zanix/auth`'s own
 * `'1y'` default. `@zanix/auth`'s `generateSessionTokens` requires this to resolve to at least
 * `MIN_REFRESH_TO_ACCESS_RATIO` (3) times whatever the access token's own lifetime resolves to —
 * a narrower margin throws an `InternalError` at the next login.
 */
export const REFRESH_TOKEN_EXPIRATION_ENV = 'REFRESH_TOKEN_EXPIRATION'

/**
 * Converts a raw `ACCESS_TOKEN_EXPIRATION_ENV`/`REFRESH_TOKEN_EXPIRATION_ENV` value into the shape
 * `parseTTL` (`@zanix/helpers`) actually parses as "already-in-seconds" vs. a unit-suffixed
 * duration string: a bare digit string (`'3600'`) is coerced into a real `number`, matching
 * `parseTTL`'s own numeric-input contract ("if a number is provided, it is assumed to already
 * represent seconds") — left as a string instead, `parseTTL` rejects a unit-less digit string
 * outright (its duration regex requires a trailing `s|m|h|d|w|mo|y`). Anything else (`'30m'`,
 * `'1h'`) is left untouched, for `parseTTL`'s own unit-suffixed parsing.
 */
function toExpirationValue(raw: string): string | number {
  return /^\d+$/.test(raw) ? Number(raw) : raw
}

/**
 * The configured access-token lifetime ({@linkcode ACCESS_TOKEN_EXPIRATION_ENV}), in the exact
 * shape `@zanix/auth`'s own `AuthSessionOptions.accessExpiration` accepts — `undefined` when
 * unset, so a caller (`AuthService.finishLogin`) can omit the field entirely and let `@zanix/auth`
 * apply its own default, rather than passing that default explicitly and coupling this project to
 * a value `@zanix/auth` could change later. Read live on every call, not cached at module load, so
 * it always reflects the current environment.
 */
export function resolveConfiguredAccessExpiration(): string | number | undefined {
  const raw = Deno.env.get(ACCESS_TOKEN_EXPIRATION_ENV)
  return raw === undefined ? undefined : toExpirationValue(raw)
}

/**
 * Same contract as {@linkcode resolveConfiguredAccessExpiration}, for
 * {@linkcode REFRESH_TOKEN_EXPIRATION_ENV}.
 */
export function resolveConfiguredRefreshExpiration(): string | number | undefined {
  const raw = Deno.env.get(REFRESH_TOKEN_EXPIRATION_ENV)
  return raw === undefined ? undefined : toExpirationValue(raw)
}

/**
 * Computes the access-token lifetime surfaced in a login/refresh response, in seconds — a 10s
 * safety margin under `configured` (or `@zanix/auth`'s own `'1h'` default when `configured` is
 * `undefined`). Extracted as a pure function of its input, separate from
 * {@linkcode TOKEN_EXPIRATION}'s own module-load-time computation, purely so it can be exercised
 * directly against every input shape {@linkcode resolveConfiguredAccessExpiration} can produce.
 */
export function computeTokenExpiration(configured: string | number | undefined): number {
  return parseTTL(configured ?? '1h') - 10
}

/**
 * Access-token lifetime surfaced in a login/refresh response, in seconds (a 10s safety margin
 * under whatever `@zanix/auth` actually issues). Computed via `parseTTL` (`@zanix/helpers` — the
 * same duration parser `@zanix/auth`'s own `generateSessionTokens`/`createAccessToken` use
 * internally) from {@linkcode resolveConfiguredAccessExpiration}, rather than a fixed literal —
 * so this stays accurate if `ACCESS_TOKEN_EXPIRATION_ENV` is ever configured to something other
 * than the default 1 hour, instead of silently reporting a stale hardcoded value while a
 * different lifetime is actually in effect.
 */
export const TOKEN_EXPIRATION: number = computeTokenExpiration(resolveConfiguredAccessExpiration())

/** Env var name for the anonymous rate limit applied to low-risk endpoints (login, OAuth2 start). */
export const FREE_RATELIMIT_ENV = 'FREE_RATELIMIT'

/** Env var name for the anonymous rate limit applied to sensitive endpoints (OTP/recovery dispatch). */
export const CRITIC_RATELIMIT_ENV = 'CRITIC_RATELIMIT'

/** Anonymous rate limit (requests/window) for low-risk auth endpoints — see `FREE_RATELIMIT_ENV`. */
export const freeRateLimit: number = Number(Deno.env.get(FREE_RATELIMIT_ENV)) || 3

/** Anonymous rate limit (requests/window) for sensitive auth endpoints — see `CRITIC_RATELIMIT_ENV`. */
export const criticRateLimit: number = Number(Deno.env.get(CRITIC_RATELIMIT_ENV)) || 1

/**
 * Env var name toggling this project's own project-wide cookie-consent modal
 * (`CookieConsentModal`, composed once in `[lang]/layout.tsx` — see that file's own doc for the
 * real login-persistence bug it exists to close). Enabled by default — {@linkcode
 * isCookieConsentEnabled} returns `true` with nothing configured at all, so that fix keeps working
 * with zero setup. Set to exactly `'false'` only for a deployment that already obtains cookie
 * consent some other way (e.g. a host-level consent banner covering this app alongside others) —
 * `space/middleware.ts`'s own `cookieConsentBypassGuard` then takes over injecting the accepted
 * signal `@zanix/auth`'s `checkAcceptedCookies` needs, so session cookies keep being emitted either
 * way.
 */
export const COOKIE_CONSENT_ENABLED_ENV = 'COOKIE_CONSENT_ENABLED'

/** Whether this project's own cookie-consent modal is active — see
 * {@linkcode COOKIE_CONSENT_ENABLED_ENV}'s own doc. Any value other than the literal `'false'`
 * (including unset) counts as enabled, matching that env var's own "opt out explicitly" contract. */
export function isCookieConsentEnabled(): boolean {
  return Deno.env.get(COOKIE_CONSENT_ENABLED_ENV) !== 'false'
}

/**
 * Env var carrying this project's own Terms and Conditions URL — presence-gated, the same
 * "presence = enabled" convention `login/page.tsx`'s own `OAUTH_PROVIDER_ENV` already applies to
 * each OAuth2 provider. When set, `login/page.tsx` shows a plain, informational link next to the
 * form; when unset, nothing renders and the login flow is otherwise unaffected — this is a link,
 * not a mandatory-acceptance checkbox blocking submit.
 */
export const TERMS_AND_CONDITIONS_URL_ENV = 'TERMS_AND_CONDITIONS_URL'

/**
 * `users` domain slice — every status a profile can be in. `ACTIVE` is the default for both an
 * admin-registered account and an OAuth2-auto-provisioned one; `INACTIVE`/`DELETED` are the only
 * states an admin can transition a profile INTO afterward (see `EDITABLE_USER_STATUS` — there is
 * no generic-edit path back to `ACTIVE`, matching the real, deployed sibling project's own
 * restriction that a status edit can never silently reactivate an account).
 */
export const USER_STATUS = ['ACTIVE', 'INACTIVE', 'DELETED'] as const

/** The subset of `USER_STATUS` an admin can set via the edit-by-id endpoint — see its own doc. */
export const EDITABLE_USER_STATUS = ['INACTIVE', 'DELETED'] as const

/**
 * `roles`/`permissions` domain slice — the shape a permission `code` must follow (`module:action`,
 * letters and hyphens only on each side of the colon). Enforced by `IsPermission`
 * (`handlers/rtos/validations/is-permission.ts`) — `@zanix/validator` ships no built-in equivalent
 * (only `IsObjectID` is a catalog decorator today).
 */
export const PERMISSION_REGEX = /^[A-Za-z-]+:[A-Za-z-]+$/

const PERMISSIONS_PREFIX = 'zanix-iam'

/**
 * Permission strings gating the `roles`/`permissions`/`grant-access`/`users` domain slices' own
 * admin endpoints (see `RolesController`/`PermissionsController`/`GrantAccessController`/
 * `UsersController`). `*Read` and `*Write` are checked together (OR, not AND — see
 * `auth-permissions-and-rate-limiting`) on every read route, so a caller holding write access can
 * always read too; only `*Write` gates a mutation.
 *
 * Unlike this domain slice's own grounding reference (`ms-iam`'s `ROLES_PERMISSIONS`),
 * there is still no dedicated `system`/`organization` split here, and `RBAC_PERMISSIONS` itself
 * needs no new entries to support this ONE product's own multi-customer/multi-organization
 * partitioning — `roles.tenantId` (see `roles/model.defs.ts`) and `grant-access.tenantId` (see
 * `grant-access/model.defs.ts`) are pure DATA scoping, checked by each repository's own query
 * filter, never a second authorization mechanism layered on top of this catalog. The same simple
 * `AuthTokenValidation({ permissions: RBAC_PERMISSIONS.* })` gate covers every tenant
 * transparently.
 *
 * `userWrite` deliberately covers BOTH registering a brand-new account (`POST /users/register`)
 * AND editing/deactivating an existing one (`PATCH /users/:id`) — a single mutation permission per
 * domain, not one split further by action, matching every other entry in this catalog:
 * `roleWrite` already covers create/edit/delete AND assigning a role to an account (itself a
 * direct privilege-escalation vector, arguably more sensitive than provisioning a plain user
 * profile), and `permissionWrite` covers both create and edit. Introducing a narrower
 * `userRegister` here would be new, asymmetric granularity this catalog doesn't apply anywhere
 * else — reusing `userWrite` for both is the deliberate, consistent choice, not a default.
 */
export const RBAC_PERMISSIONS = {
  roleRead: `${PERMISSIONS_PREFIX}:role-read`,
  roleWrite: `${PERMISSIONS_PREFIX}:role-write`,
  permissionRead: `${PERMISSIONS_PREFIX}:permission-read`,
  permissionWrite: `${PERMISSIONS_PREFIX}:permission-write`,
  grantAccessRead: `${PERMISSIONS_PREFIX}:grant-access-read`,
  grantAccessWrite: `${PERMISSIONS_PREFIX}:grant-access-write`,
  userRead: `${PERMISSIONS_PREFIX}:user-read`,
  userWrite: `${PERMISSIONS_PREFIX}:user-write`,
} as const

/**
 * `grant-access` domain slice — the default access-level hierarchy `defaultEvaluateGrantAccess`
 * (`utils/grant-access.ts`) orders ascending: `MANAGE` satisfies a `READ`/`WRITE` requirement,
 * `WRITE` satisfies a `READ` requirement, `READ` satisfies only itself. Generalizes the grounding
 * reference's own bare `accessLevel === 'MANAGE'` string check into an actual ordering.
 * `GrantAccessAttrs.accessLevel` itself stays a free-form `string` (see that model's own doc) — a
 * value outside this list is compared by exact equality instead, never rejected or coerced.
 */
export const DEFAULT_ACCESS_LEVELS = ['READ', 'WRITE', 'MANAGE'] as const
