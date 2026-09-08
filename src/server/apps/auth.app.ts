import type { OAuth2ConnectorOptions } from '@zanix/auth'
import type { ZanixConnector } from '@zanix/server'

import { defineZanixApp } from '@zanix/app'
import { registerResourceType } from '@zanix/app/runtime'
import { HttpError, InternalError } from '@zanix/errors'
import {
  GITHUB_OAUTH2_CLIENT_ID_ENV,
  GITHUB_OAUTH2_CLIENT_SECRET_ENV,
  GITHUB_OAUTH2_REDIRECT_URI_ENV,
  GitHubOAuth2Connector,
  GOOGLE_OAUTH2_CLIENT_ID_ENV,
  GOOGLE_OAUTH2_CLIENT_SECRET_ENV,
  GOOGLE_OAUTH2_REDIRECT_URI_ENV,
  GoogleOAuth2Connector,
  resolveCaptchaAdapter,
  resolveCaptchaProvider,
} from '@zanix/auth'
import { TemplatesAdminRepository } from '@zanix/notifications'
import { resolveEffectivePermissions } from 'utils/rbac.ts'

/**
 * Resource-type factory for a Google OAuth2 connector — `@zanix/app`'s `ResourceFactory` accepts a
 * real `ZanixConnector` instance directly (no `{ connector, close: () => {} }` wrapper needed):
 * `GoogleOAuth2Connector` extends `@zanix/server`'s `OAuth2Connector`/`ZanixConnector`, whose own
 * `close()` — `protected`, framework-internal — is exactly what the registry now calls through
 * ordinary inheritance-based assignability, not a structural check a plain wrapper object had to
 * work around.
 */
registerResourceType(
  'oauth2-google',
  (options) => new GoogleOAuth2Connector(options as OAuth2ConnectorOptions),
)

/** Resource-type factory for a GitHub OAuth2 connector — same reasoning as `'oauth2-google'`
 * above. */
registerResourceType(
  'oauth2-github',
  (options) => new GitHubOAuth2Connector(options as OAuth2ConnectorOptions),
)

/**
 * Resource-type factory for a captcha provider adapter, delegating to `@zanix/auth`'s own
 * `resolveCaptchaAdapter()` rather than re-deriving the provider-to-adapter/env-var mapping here.
 * Only ever registered (see `resources.captcha` below) when `resolveCaptchaProvider()` already
 * resolved once — the `InternalError` below guards a real TOCTOU gap (env changing between that
 * check and this factory actually running), not the common path.
 *
 * Every built-in adapter `resolveCaptchaAdapter()` can return (`RecaptchaAdapter`/
 * `HCaptchaAdapter`/`TurnstileAdapter`) extends `@zanix/server`'s `RestClient` — a real
 * `ZanixConnector` — so the cast below is honest, not a widening lie; it would only be wrong for a
 * custom, non-`ZanixConnector` `options.adapter`, which this factory never passes.
 */
registerResourceType('captcha-provider', () => {
  const adapter = resolveCaptchaAdapter({})
  if (!adapter) {
    throw new InternalError(
      '[auth.app] captcha-provider resource resolved with no provider configured.',
    )
  }
  return adapter as unknown as ZanixConnector
})

/**
 * Raw Handlebars source for the `totp-enabled` email template — a genuinely project-specific
 * event none of `@zanix/notifications`' built-in templates cover (see `notifications-templates`'s
 * registry table). Database-backed templates (`TEMPLATES_BACKEND=local`) render `hbs` directly,
 * with no compile step of its own to run — unlike the package's own precompiled code templates.
 */
const TOTP_ENABLED_TEMPLATE_HBS = `
<h1>Two-factor authentication enabled</h1>
<p>Two-factor authentication (authenticator app) has been enabled on your zanix-iam account.</p>
<p>If you did not perform this action, please contact support immediately.</p>
`.trim()

const resources: Record<string, { type: string; options: Record<string, unknown> }> = {}

if (Deno.env.has(GOOGLE_OAUTH2_CLIENT_ID_ENV)) {
  resources.googleOAuth2 = {
    type: 'oauth2-google',
    options: {
      clientId: Deno.env.get(GOOGLE_OAUTH2_CLIENT_ID_ENV),
      clientSecret: Deno.env.get(GOOGLE_OAUTH2_CLIENT_SECRET_ENV),
      redirectUri: Deno.env.get(GOOGLE_OAUTH2_REDIRECT_URI_ENV),
      // Explicit, not left to `GoogleOAuth2Connector`'s own 'token' (implicit-flow) default —
      // `AuthService.loginWithOauthCallback` calls `validateCode()`, the code-flow method (see
      // `auth-oauth2`'s security rationale for preferring it); leaving this unset would make
      // `generateAuthUrl()` build a `response_type=token` URL that mismatches what the callback
      // handler actually expects (`OAuthLoginRTO.code`, not a bearer token) — a real, confirmed
      // bug caught by this project's own integration test logging the connector's own implicit-
      // flow warning during construction.
      responseType: 'code',
    },
  }
}

if (Deno.env.has(GITHUB_OAUTH2_CLIENT_ID_ENV)) {
  resources.githubOAuth2 = {
    type: 'oauth2-github',
    options: {
      clientId: Deno.env.get(GITHUB_OAUTH2_CLIENT_ID_ENV),
      clientSecret: Deno.env.get(GITHUB_OAUTH2_CLIENT_SECRET_ENV),
      redirectUri: Deno.env.get(GITHUB_OAUTH2_REDIRECT_URI_ENV),
    },
  }
}

if (resolveCaptchaProvider()) {
  resources.captcha = { type: 'captcha-provider', options: {} }
}

/**
 * The `auth` domain slice's own Zanix App — the customization layer a host can compose this
 * project's authentication mechanisms through, without forking `zanix-iam`'s own code (see
 * `app-manifest-and-composition`/`app-behaviors-and-overrides`).
 *
 * `routes: false` deliberately: this app's job is config/resource/behavior composition only.
 * `login.handler.ts`/`password.handler.ts` stay on this project's ordinary, unprefixed
 * project-root auto-discovery (the same mechanism `mod.ts`'s own header comment already
 * describes) rather than being scoped inside this app's own `ProgramModule.defineApplication`
 * namespace via `ctx.routes()` — deferred deliberately, not a silent gap: `ctx.routes()`'s real
 * scoping semantics for a DYNAMICALLY imported, decorator-registered class (as opposed to a
 * synchronous `defineRoute` call) depend on `@zanix/app`'s underlying async-context propagation
 * across the `await import(...)` boundary, which isn't yet validated by any real, shipped
 * precedent in this ecosystem — getting it wrong would silently mis-scope routing for this
 * "foundation" slice AND the 4 slices meant to build on it. A deliberate scope boundary, not an
 * oversight.
 */
const authApp: ReturnType<typeof defineZanixApp> = defineZanixApp({
  name: 'auth',
  routes: false,
  runtime: { mode: 'embedded' },
  dependencies: {
    googleOAuth2: { type: 'oauth2-google', required: false },
    githubOAuth2: { type: 'oauth2-github', required: false },
    captcha: { type: 'captcha-provider', required: false },
  },
  resources,
  config: {
    otpRequired: { type: 'boolean', default: false },
    totpRequired: { type: 'boolean', default: false },
    freeRateLimit: { type: 'number', default: 3 },
    criticRateLimit: { type: 'number', default: 1 },
    ipAllowlist: { type: 'string', default: '' },
    /**
     * Number of 30s TOTP steps before/after the current one to accept, tolerating clock drift
     * between the server and the user's authenticator app (forwarded as `verifyTOTP`'s own
     * `window` option, via `resolveConfig('auth', 'totpToleranceSteps')`). A plain value with no
     * override-time logic of its own — see the Configuration/Extension/Override table
     * (`app-behaviors-and-overrides`) for why this belongs in `config`, not `behaviors`. Override
     * to tighten/loosen tolerance without forking the TOTP flow.
     */
    totpToleranceSteps: { type: 'number', default: 1 },
    /**
     * Whether a first-time OAuth2 login (an email with no existing `auth` record) may
     * auto-provision a new account, versus requiring one to already exist (pre-provisioned
     * through `POST /users/register` — the `users` domain slice's own restricted, admin-only
     * registration endpoint). Read via `resolveConfig('auth', 'selfRegistrationViaOAuth')` from
     * `AuthService.loginWithOauthCallback` — a plain value with no override-time logic of its own
     * (same reasoning as `totpToleranceSteps` above). Override to `false` to make OAuth2 login
     * exclusively an authentication method for accounts an admin already created, never a
     * registration path.
     */
    selfRegistrationViaOAuth: { type: 'boolean', default: true },
  },
  behaviors: {
    passwordPolicy: {
      default: (password: string): true | string => {
        if (password.length < 8) return 'Password must be at least 8 characters long.'
        if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter.'
        if (!/[0-9]/.test(password)) return 'Password must contain a digit.'
        return true
      },
      description:
        'Validates a new/changed password before it is persisted. Override to enforce a ' +
        'different policy (length, character classes, a breached-password check) without ' +
        'forking `PasswordService`/`AuthService`.',
    },
    totpProvisioningLabel: {
      default: (email: string): string => email,
      description:
        'Account label shown inside the authenticator app for a TOTP enrollment QR code. ' +
        'Override to show something other than the raw login email (e.g. a display name).',
    },
    /**
     * The RBAC evaluation strategy: given the caller's own resolved (already role→permissions
     * -populated) `roles` document, returns the flat permission-code list embedded into a
     * session token's `aud` claim at login (see `AuthService`/`PasswordService`'s own
     * `resolveSessionPermissions` call sites). The default (`resolveEffectivePermissions`, see
     * `utils/rbac.ts`) reproduces this domain slice's own grounding reference's real behavior —
     * a role's active permissions, flattened to codes — with no organization scoping (this
     * project's own `roles` model carries none, see that model's own doc for why).
     *
     * Override to swap in an entirely different evaluation strategy — a role hierarchy, a
     * wildcard-expansion policy, an external policy engine — without forking `AuthService`. See
     * `app-behaviors-and-overrides` for the general mechanism. This behavior lives on `auth.app.ts`
     * rather than on a separate `roles`/`permissions` manifest of their own because it's a
     * login-time concern: it feeds directly into the session token minted by
     * `AuthService`/`PasswordService`, not a standalone RBAC-catalog operation.
     */
    resolveEffectivePermissions: {
      default: resolveEffectivePermissions,
      description:
        'Computes the flat permission-code list embedded into a session token from the ' +
        "caller's own resolved role. Override to change how a role's permission set is " +
        'evaluated (a hierarchy, a wildcard-expansion policy, an external policy engine) ' +
        'without forking `AuthService`/`PasswordService`.',
    },
  },
  setup: async (ctx) => {
    // `@zanix/notifications` has no built-in template for this event (see `notifications-templates`'s
    // registry table — email ships `welcome`/`password-changed`/`password-recovery`/`login-otp`/
    // `new-login`/`data-table`, none of them this) — a genuinely project-specific, database-only
    // template (`TEMPLATES_BACKEND=local` required — see this project's own README/`.env.example`),
    // seeded idempotently here rather than via a one-off manual CRUD call, so a fresh environment
    // gets it automatically. `create()` throws `CONFLICT` once already seeded — expected on every
    // boot after the first, not a real failure.
    try {
      await ctx.resolve(TemplatesAdminRepository).create({
        channel: 'email',
        name: 'totp-enabled',
        hbs: TOTP_ENABLED_TEMPLATE_HBS,
        description: 'Sent when an account enables TOTP (authenticator-app) 2FA.',
      }, 'system')
    } catch (error) {
      if (!(error instanceof HttpError) || error.status.code !== 'CONFLICT') throw error
    }
  },
})

export default authApp
