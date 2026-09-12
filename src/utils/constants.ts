/**
 * Shared constants for the `auth` domain slice (and, by convention, for every future domain
 * slice added to this project — `roles`/`permissions`/`users`/`grant-access`).
 */

import { InternalError } from '@zanix/errors'
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
 * Env var carrying this project's own Privacy Notice URL — same presence-gated contract as
 * {@linkcode TERMS_AND_CONDITIONS_URL_ENV}, and independent of it: a deployment can set either,
 * both, or neither. When set, `login/page.tsx` shows a plain, informational link next to the form;
 * when unset, nothing renders and the login flow is otherwise unaffected.
 */
export const PRIVACY_NOTICE_URL_ENV = 'PRIVACY_NOTICE_URL'

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

/**
 * Env var name for this deployed instance's own identity — used to build the RBAC permission
 * prefix ({@linkcode RBAC_PERMISSIONS}), the TOTP issuer (`AuthService.enrollTotp`), and the
 * copy of emails sent to the end user (account-welcome/TOTP-enabled), so a self-hosted instance
 * never surfaces the literal string `'zanix-iam'` (the Zanix team's own instance) to its own
 * users. See {@linkcode SERVICE_ID}.
 */
export const SERVICE_ID_ENV = 'SERVICE_ID'

/**
 * This deployed instance's own identity — see {@linkcode SERVICE_ID_ENV}. Defaults to
 * `'zanix-iam'` when unset, so the Zanix team's own instance needs no env var change to keep
 * behaving identically. Validated eagerly against {@linkcode PERMISSION_REGEX}'s own module-name
 * charset (letters and hyphens only) — a malformed override would otherwise silently build
 * unmatchable permission codes rather than failing fast at boot.
 */
export const SERVICE_ID: string = Deno.env.get(SERVICE_ID_ENV) || 'zanix-iam'

if (!/^[A-Za-z-]+$/.test(SERVICE_ID)) {
  throw new InternalError(
    `${SERVICE_ID_ENV} must contain only letters and hyphens — got: "${SERVICE_ID}"`,
    { code: 'IAM_INVALID_SERVICE_ID' },
  )
}

const PERMISSIONS_PREFIX = SERVICE_ID

/**
 * Env var name for the email of this project's own opt-in, production-safe first-admin bootstrap
 * account — see `server/repositories/users/seeders/seeders.prod.ts` and
 * `server/repositories/auth/seeders/seeders.prod.ts`, which seed it only when this AND
 * {@linkcode FIRST_ADMIN_PASSWORD_ENV} are both set. On a genuinely fresh deployment,
 * `POST /users/register` itself is gated behind `RBAC_PERMISSIONS.userWrite` — which nobody holds
 * yet — so without this, there is no production-safe way to create the first account at all.
 */
export const FIRST_ADMIN_EMAIL_ENV = 'FIRST_ADMIN_EMAIL'

/**
 * Env var name for the password of the account {@linkcode FIRST_ADMIN_EMAIL_ENV} names — see that
 * constant's own doc. Hashed automatically on insert, same as every other `auth.password` write
 * (`protection: 'hash'`, `auth/model.defs.ts`) — never logged or stored in plain text.
 */
export const FIRST_ADMIN_PASSWORD_ENV = 'FIRST_ADMIN_PASSWORD'

/**
 * Env var name for a JSON object of `--space-*` design-token overrides this instance's login/2FA/
 * password-recovery UI should render with — consumed by `space.app.ts`'s own `theme.resolve`. Same
 * "one env var, JSON value" shape `@zanix/admin`'s own `ZANIX_ADMIN_SERVICES` already establishes
 * — reused here rather than a bespoke `--customizations <file>` mechanism, which would depend on a
 * file already being on disk, undercutting the zero-clone deployment this exists for. Unset means
 * no override — this instance renders with `@zanix/space-ui`'s own default tokens, same as today.
 */
export const THEME_ENV = 'IAM_THEME'

/**
 * Parses {@linkcode THEME_ENV} into the `Record<string, string>` shape `defineSpaceApp`'s own
 * `theme.resolve` returns — `undefined` when unset (no override), so `space.app.ts` doesn't need
 * its own `try`/`catch`. A malformed value throws eagerly rather than silently applying no theme —
 * `theme.resolve` runs on every response, so surfacing this at the very first request (a loud
 * boot-adjacent failure) beats a self-hosted operator quietly wondering why their configured colors
 * never show up. Sanitization of the resulting keys/values (rejecting `;`/`{`/`}`/`<`/`>`/backtick)
 * is `@zanix/space`'s own `theme.resolve` responsibility — not duplicated here.
 */
export function resolveThemeOverrides(): Record<string, string> | undefined {
  const raw = Deno.env.get(THEME_ENV)
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as Record<string, string>
  } catch {
    throw new InternalError(`${THEME_ENV} must be valid JSON — got: "${raw}"`, {
      code: 'IAM_INVALID_THEME',
    })
  }
}

/**
 * Env var name for a JSON object of message-catalog overrides — merged ON TOP of
 * `loadMessages()`'s own resolved catalog (`[lang]/layout.tsx`'s own loader), same "one env var,
 * JSON value" shape as {@linkcode THEME_ENV}. Lets a self-hosted instance override/translate any
 * catalog key (e.g. `{"login/subject-welcome":"Bienvenido a Acme"}`) without clonning — the SAME
 * env-var-JSON pattern `@zanix/admin`'s own `ZANIX_ADMIN_SERVICES` already establishes. Unset means
 * no override — every page renders the base `en/index.json` catalog unchanged.
 */
export const MESSAGES_ENV = 'IAM_MESSAGES'

/**
 * Parses {@linkcode MESSAGES_ENV} — `undefined` when unset, so a caller can spread it
 * conditionally (`{...base, ...resolveMessageOverrides()}`) with no special-casing. Same
 * fail-loud-not-halfway posture as {@linkcode resolveThemeOverrides} — a malformed value throws at
 * the first request rather than silently rendering the base catalog with no indication why the
 * configured override never took effect.
 */
export function resolveMessageOverrides(): Record<string, string> | undefined {
  const raw = Deno.env.get(MESSAGES_ENV)
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as Record<string, string>
  } catch {
    throw new InternalError(`${MESSAGES_ENV} must be valid JSON — got: "${raw}"`, {
      code: 'IAM_INVALID_MESSAGES',
    })
  }
}

/**
 * Env var name for the DEFAULT post-login/2FA-confirmation/password-recovery destination — the
 * fallback every `action`'s own success branch across `login`, `login/otp/[email]`,
 * `login/totp/[email]`, `totp/confirm`, and `password/recovery/callback` uses when the request
 * carried no (or an unsafe) {@linkcode REDIRECT_TO_PARAM}. Also `LoginPage`/`TotpConfirmPage`'s own
 * `redirect.to`, which bounces an ALREADY-signed-in request away from those same pages — that one
 * config field is a static string, not a function of the request (`@zanix/space`'s own
 * `RedirectConfig.to` — unlike its sibling `condition`), so it can only ever use this default, never
 * `REDIRECT_TO_PARAM`. This project ships no dashboard/account page of its own (see `LoginPage`'s
 * own doc) — `'/'` is a placeholder every one of those pages already assumed, not a real
 * destination; a host embedding this app alongside its own frontend sets this once instead of
 * forking five files.
 */
export const POST_LOGIN_REDIRECT_URL_ENV = 'POST_LOGIN_REDIRECT_URL'

/** The configured DEFAULT post-login destination — see {@linkcode POST_LOGIN_REDIRECT_URL_ENV}.
 * Defaults to `'/'`, unchanged from every call site's own previous hardcoded literal. Prefer
 * {@linkcode resolvePostLoginRedirect} at any real `action` call site — this is the fallback it
 * falls back TO, not the per-request answer. */
export const postLoginRedirectUrl: () => string = () =>
  Deno.env.get(POST_LOGIN_REDIRECT_URL_ENV) || '/'

/**
 * Query param carrying a CALLER-specified post-login destination — e.g. a protected page this
 * project's own host redirected an anonymous visitor away from, appending
 * `?redirect_to=/the/original/path` so `login/page.tsx`'s own success branch can send them back
 * instead of always landing on {@linkcode POST_LOGIN_REDIRECT_URL_ENV}'s fixed default. Threaded
 * through the 2FA challenge hop (`login/otp/[email]`/`login/totp/[email]`) by `login/page.tsx`'s
 * own 2FA-required redirect, so it survives that extra step — see `login/page.tsx`'s own `action`.
 */
export const REDIRECT_TO_PARAM = 'redirect_to'

/**
 * Comma-separated allowlist of trusted, fully-qualified origins (e.g.
 * `https://app.example.com,https://admin.example.com`) a {@linkcode REDIRECT_TO_PARAM} may
 * point at ABSOLUTELY, on top of the same-origin relative paths {@linkcode isSafeRedirectTarget}
 * always allows. Empty/unset by default — no absolute URL is ever trusted until an operator opts
 * in explicitly, so this project's own zero-config default behaves exactly as it did before this
 * option existed.
 *
 * Real motivation: a consumer app deployed on a genuinely DIFFERENT origin from this project's own
 * (its own domain/port, its own cookie scope — this ecosystem's normal multi-app-per-service
 * topology) can send a visitor to THIS project's own hosted login/2FA/consent UI and get them back
 * on ITS OWN domain afterward, instead of hand-rolling a second login UI against this project's
 * plain REST API just because it happens to live on a different origin. A comma-separated string,
 * not JSON like {@linkcode THEME_ENV}/{@linkcode MESSAGES_ENV} — this is a flat list of strings,
 * not a structured value, and a CSV is the lighter-weight, easier-to-hand-author shape for that
 * (no quotes/brackets to get right), matching how an origin allowlist is conventionally written.
 */
export const TRUSTED_REDIRECT_ORIGINS_ENV = 'TRUSTED_REDIRECT_ORIGINS'

/** Parses {@linkcode TRUSTED_REDIRECT_ORIGINS_ENV} into a real, trimmed list of origins — `[]`
 * when unset (never throws: an operator who never sets this at all is the overwhelmingly common
 * case, and must see IDENTICAL behavior to before this option existed, not a boot-time failure). */
function resolveTrustedRedirectOrigins(): string[] {
  const raw = Deno.env.get(TRUSTED_REDIRECT_ORIGINS_ENV)
  if (!raw) return []
  return raw.split(',').map((origin) => origin.trim()).filter(Boolean)
}

/**
 * Whether `value` is safe to actually redirect to — a genuine relative path, OR an absolute URL
 * whose origin exactly matches {@linkcode TRUSTED_REDIRECT_ORIGINS_ENV}'s configured allowlist.
 * Rejects a protocol-relative URL (`//attacker.example`, still followed by every browser as
 * `https://attacker.example`) and any absolute URL not on that allowlist — without this check,
 * {@linkcode REDIRECT_TO_PARAM} would be a textbook open redirect: this instance's own, trusted
 * domain used to bounce a just-authenticated visitor to an attacker-controlled page.
 */
function isSafeRedirectTarget(value: string | null): value is string {
  if (!value) return false
  if (value.startsWith('/') && !value.startsWith('//')) return true
  // Cheap shape check before the `new URL()` try/catch below — rules out a protocol-relative
  // value (already handled above) and anything that isn't `http(s)` at all (e.g. `javascript:`,
  // `mailto:`) without needing to construct a URL just to reject it.
  if (!/^https?:\/\//.test(value)) return false
  try {
    return resolveTrustedRedirectOrigins().includes(new URL(value).origin)
  } catch {
    // A malformed absolute-looking string (e.g. `https://`) — never safe.
    return false
  }
}

/**
 * Resolves where a successful login/2FA-confirmation/password-recovery should land for THIS
 * request. {@linkcode REDIRECT_TO_PARAM}'s own query param wins whenever it's present and safe
 * (see {@linkcode isSafeRedirectTarget} — a same-origin relative path always qualifies, an
 * absolute URL only when it's on {@linkcode TRUSTED_REDIRECT_ORIGINS_ENV}'s allowlist); otherwise
 * falls back to {@linkcode postLoginRedirectUrl}'s configured default. The one call site this
 * can't help — `LoginPage`/`TotpConfirmPage`'s own static `redirect.to` — has no per-request
 * `ctx`/`url` to read a query param from at all; see {@linkcode POST_LOGIN_REDIRECT_URL_ENV}'s own
 * doc for why. `redirectResponse`'s own `location` param already accepts "a path or full URL", so
 * a trusted absolute target returned here needs no special handling at the call site.
 */
export function resolvePostLoginRedirect(url: URL): string {
  const requested = url.searchParams.get(REDIRECT_TO_PARAM)
  return isSafeRedirectTarget(requested) ? requested : postLoginRedirectUrl()
}

/**
 * Appends `url`'s own {@linkcode REDIRECT_TO_PARAM} (when present and safe — see
 * {@linkcode isSafeRedirectTarget}) onto `path` — how `login/page.tsx`'s own 2FA-required redirect
 * carries a caller-specified destination THROUGH the OTP/TOTP challenge hop, so
 * `resolvePostLoginRedirect` still sees it once that challenge's own `action` finally succeeds. A
 * no-op (returns `path` unchanged) when `url` carries no safe `redirect_to` of its own.
 */
export function withRedirectToParam(path: string, url: URL): string {
  const requested = url.searchParams.get(REDIRECT_TO_PARAM)
  if (!isSafeRedirectTarget(requested)) return path
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}${REDIRECT_TO_PARAM}=${encodeURIComponent(requested)}`
}

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
  /** Gates `templates.handler.ts`'s own `/templates` CRUD API — one permission for the whole
   * controller (no read/write split, matching that guard's own single-permission shape). Was
   * previously a bespoke `'iam:templates'` literal, inconsistent with every other entry here
   * (wrong prefix, no real catalog entry) — folded in for consistency. */
  templatesAccess: `${PERMISSIONS_PREFIX}:templates-access`,
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
