import type { OAuth2ConnectorOptions } from '@zanix/auth'
import type { ZanixConnector } from '@zanix/server'

import { defineZanixApp } from '@zanix/app'
import { registerResourceType, resolveTarget } from '@zanix/app/runtime'
import { InternalError } from '@zanix/errors'
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
import { registerTemplateSeeds } from '@zanix/notifications'
import { defaultRoleId, isSelfRegistrationEnabled, SERVICE_ID } from 'utils/constants.ts'
import { AccountContactService } from '../interactors/account-contact.interactor.ts'
import { resolveEffectivePermissions } from 'utils/rbac.ts'

/**
 * Resource-type factory for a Google OAuth2 connector — `@zanix/app`'s `ResourceFactory` accepts a
 * real `ZanixConnector` instance directly (no `{ connector, close: () => {} }` wrapper needed):
 * `GoogleOAuth2Connector` extends `@zanix/server`'s `OAuth2Connector`/`ZanixConnector`, whose own
 * `protected`, framework-internal `close()` is what the registry calls on teardown.
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
 * The `totp-enabled`, `totp-disabled`, `totp-backup-code-used` and `totp-reset-by-operator` emails
 * — genuinely project-specific events none of
 * `@zanix/notifications`' built-in templates cover — and their words, in English and Spanish.
 * Registered with the library, which syncs them into the templates collection like its own built-ins
 * (`TEMPLATES_BACKEND=local`; with any other mode there is no collection and this has no effect): added
 * when missing, kept up to date while nobody edits them, an operator's edit never overwritten, and a
 * host that registers the same `{channel, name}` or keys replaces them. The words are a catalog read
 * with `{{t}}`, so the message goes out in the language of the request (`?lang=`, `Accept-Language`).
 */
registerTemplateSeeds({
  templates: [{
    channel: 'email',
    name: 'totp-enabled',
    description: 'Sent when an account enables TOTP (authenticator-app) 2FA.',
    hbs: "<h1>{{t 'totp-enabled.title'}}</h1>\n<p>{{t 'totp-enabled.content'}}</p>",
  }, {
    channel: 'email',
    name: 'totp-disabled',
    description: 'Sent when an account turns TOTP (authenticator-app) 2FA off.',
    hbs: "<h1>{{t 'totp-disabled.title'}}</h1>\n<p>{{t 'totp-disabled.content'}}</p>",
  }, {
    channel: 'email',
    name: 'totp-backup-code-used',
    description:
      'Sent when a backup code was used instead of an authenticator code. Variable: remaining (how many backup codes are left).',
    availableVariables: ['remaining'],
    hbs:
      "<h1>{{t 'totp-backup-code-used.title'}}</h1>\n{{#if remaining}}<p>{{t 'totp-backup-code-used.content' remaining=remaining}}</p>{{else}}<p>{{t 'totp-backup-code-used.content-none'}}</p>{{/if}}",
  }, {
    channel: 'email',
    name: 'totp-reset-by-operator',
    description:
      'Sent when support removes the authenticator app of an account because the person lost it.',
    hbs:
      "<h1>{{t 'totp-reset-by-operator.title'}}</h1>\n<p>{{t 'totp-reset-by-operator.content'}}</p>",
  }],
  messages: {
    en: {
      'totp-enabled.subject': 'Two-factor authentication enabled',
      'totp-enabled.title': 'Two-factor authentication enabled',
      'totp-enabled.content':
        `Two-factor authentication (authenticator app) has been enabled on your ${SERVICE_ID} account. If you did not perform this action, please contact support immediately.`,
      'totp-disabled.subject': 'Two-factor authentication turned off',
      'totp-disabled.title': 'Two-factor authentication turned off',
      'totp-disabled.content':
        `Two-factor authentication (authenticator app) has been turned off on your ${SERVICE_ID} account. If you did not perform this action, change your password and contact support immediately.`,
      'totp-backup-code-used.subject': 'A backup code was used to sign in',
      'totp-backup-code-used.title': 'A backup code was used',
      'totp-backup-code-used.content':
        `A backup code was used to confirm your identity on your ${SERVICE_ID} account. You have {remaining} backup codes left. If you did not do this, change your password and contact support immediately.`,
      'totp-backup-code-used.content-none':
        `A backup code was used to confirm your identity on your ${SERVICE_ID} account. You have no backup codes left: generate a new set from your security settings. If you did not do this, change your password and contact support immediately.`,
      'totp-reset-by-operator.subject': 'Two-factor authentication removed by support',
      'totp-reset-by-operator.title': 'Two-factor authentication removed by support',
      'totp-reset-by-operator.content':
        `Support removed the second step (authenticator app) from your ${SERVICE_ID} account. Sign in and enable it again. If you did not ask for this, contact support immediately.`,
    },
    es: {
      'totp-enabled.subject': 'Verificación en dos pasos activada',
      'totp-enabled.title': 'Verificación en dos pasos activada',
      'totp-enabled.content':
        `Se activó la verificación en dos pasos (app de autenticación) en tu cuenta de ${SERVICE_ID}. Si no fuiste tú, contacta a soporte de inmediato.`,
      'totp-disabled.subject': 'Verificación en dos pasos desactivada',
      'totp-disabled.title': 'Verificación en dos pasos desactivada',
      'totp-disabled.content':
        `Se desactivó la verificación en dos pasos (app de autenticación) en tu cuenta de ${SERVICE_ID}. Si no fuiste tú, cambia tu contraseña y contacta a soporte de inmediato.`,
      'totp-backup-code-used.subject': 'Se usó un código de respaldo para iniciar sesión',
      'totp-backup-code-used.title': 'Se usó un código de respaldo',
      'totp-backup-code-used.content':
        `Se usó un código de respaldo para confirmar tu identidad en tu cuenta de ${SERVICE_ID}. Te quedan {remaining} códigos de respaldo. Si no fuiste tú, cambia tu contraseña y contacta a soporte de inmediato.`,
      'totp-backup-code-used.content-none':
        `Se usó un código de respaldo para confirmar tu identidad en tu cuenta de ${SERVICE_ID}. Ya no te quedan códigos de respaldo: genera un juego nuevo desde la seguridad de tu cuenta. Si no fuiste tú, cambia tu contraseña y contacta a soporte de inmediato.`,
      'totp-reset-by-operator.subject': 'Soporte quitó la verificación en dos pasos',
      'totp-reset-by-operator.title': 'Soporte quitó la verificación en dos pasos',
      'totp-reset-by-operator.content':
        `Soporte quitó el segundo paso (app de autenticación) de tu cuenta de ${SERVICE_ID}. Inicia sesión y actívalo de nuevo. Si no lo pediste, contacta a soporte de inmediato.`,
    },
  },
})

const resources: Record<string, { type: string; options: Record<string, unknown> }> = {}

if (Deno.env.has(GOOGLE_OAUTH2_CLIENT_ID_ENV)) {
  resources.googleOAuth2 = {
    type: 'oauth2-google',
    options: {
      clientId: Deno.env.get(GOOGLE_OAUTH2_CLIENT_ID_ENV),
      clientSecret: Deno.env.get(GOOGLE_OAUTH2_CLIENT_SECRET_ENV),
      redirectUri: Deno.env.get(GOOGLE_OAUTH2_REDIRECT_URI_ENV),
      // Explicit, not left to `GoogleOAuth2Connector`'s own 'token' (implicit-flow) default —
      // `AuthService.loginWithOauthCallback` calls `validateCode()`, the code-flow method;
      // leaving this unset would make `generateAuthUrl()` build a `response_type=token` URL that
      // mismatches what the callback handler expects (`OAuthLoginRTO.code`, not a bearer token).
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
 * The `auth` domain's own Zanix App — the customization layer a host can compose this project's
 * authentication mechanisms through (config, resources, behaviors), without forking this project's
 * code.
 *
 * `routes: false` deliberately: this app's job is config/resource/behavior composition only.
 * `login.handler.ts`/`password.handler.ts` stay on this project's ordinary, unprefixed
 * project-root auto-discovery (see `mod.ts`'s own doc) rather than being scoped inside this app's
 * own `ProgramModule.defineApplication` namespace via `ctx.routes()`: `ctx.routes()`'s scoping of
 * a DYNAMICALLY imported, decorator-registered class (as opposed to a synchronous `defineRoute`
 * call) depends on `@zanix/app`'s async-context propagation across the `await import(...)`
 * boundary, and mis-scoping it would silently break routing for every domain built on `auth`.
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
    /**
     * Number of 30s TOTP steps before/after the current one to accept, tolerating clock drift
     * between the server and the user's authenticator app (forwarded as `verifyTOTP`'s own
     * `window` option, via `resolveConfig('auth', 'totpToleranceSteps')`). A plain value with no
     * override-time logic of its own, so it belongs in `config`, not `behaviors`. Override to
     * tighten/loosen tolerance without forking the TOTP flow.
     */
    totpToleranceSteps: { type: 'number', default: 1 },
    /**
     * Whether a first-time OAuth2 login (an email with no existing `auth` record) may
     * auto-provision a new account, versus requiring one to already exist (pre-provisioned
     * through `POST /users/register` — the `users` domain's own restricted, admin-only
     * registration endpoint). Read via `resolveConfig('auth', 'selfRegistrationViaOAuth')` from
     * `AuthService.loginWithOauthCallback` — a plain value with no override-time logic of its own
     * (same reasoning as `totpToleranceSteps` above). Override to `false` to make OAuth2 login
     * exclusively an authentication method for accounts an admin already created, never a
     * registration path.
     */
    selfRegistrationViaOAuth: { type: 'boolean', default: isSelfRegistrationEnabled() },
    /**
     * Whether a first-time OTP-login request for an unrecognized email (`GET /login/otp/:email`
     * with no matching `auth` record) may auto-provision a new account, versus requiring one to
     * already exist. Same shape/reasoning as {@link selfRegistrationViaOAuth} above, read via
     * `resolveConfig('auth', 'selfRegistrationViaOTP')` from `PasswordService.recovery`/
     * `AuthService.loginWithOTPCallback`. **Deliberately scoped to the OTP-as-*login* path
     * only** — a genuine password-recovery request for an unrecognized email is never affected by
     * this flag (see `PasswordService.recovery`'s own doc for why: silently creating an account
     * from an arbitrary "forgot password" email would be a real, unverified account-creation
     * vector, an entirely different risk from a login-time OTP request). Unlike the OAuth2 case,
     * the new account isn't actually created until the code is verified (`loginWithOTPCallback`)
     * — the dispatch step alone never writes a new `auth`/`users` record, only generates a code
     * against the plain `email` as its cache target. Override to `false` to make OTP login
     * exclusively an authentication method for accounts an admin already created, never a
     * registration path.
     */
    selfRegistrationViaOTP: { type: 'boolean', default: isSelfRegistrationEnabled() },
    /**
     * The `roles.id` auto-assigned to a brand-new account created through EITHER
     * self-registration path (OTP or OAuth2), read via `resolveConfig('auth', 'defaultRoleId')`
     * from `AuthService.loginWithOTPCallback`/`loginWithOauthCallback` — the exact same call in
     * both branches, so the two flows stay symmetric by construction. Defaults from
     * {@linkcode defaultRoleId} (`DEFAULT_ROLE_ID_ENV`) — see that constant's own doc for the
     * unset behavior and when a host needs to set it.
     */
    defaultRoleId: { type: 'string', default: defaultRoleId ?? '' },
  },
  operations: {
    /**
     * The login address of accounts, for the services that deliver messages on a person's behalf:
     * `{ authIds: string[] }` answers `{ emails: { [authId]: address } }`, with closed and unknown
     * accounts left out (see `AccountContactService`). Limited to `notifications`, the one app that
     * sends, so the address is read at the moment of sending and never stored by a product service.
     */
    resolveAccountEmails: {
      allowedCallers: ['notifications'],
      handler: async (payload) => {
        const service = resolveTarget('auth', AccountContactService)
        const { authIds } = (payload ?? {}) as { authIds?: unknown }
        return { emails: await service.resolveEmails(authIds) }
      },
    },
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
     * `utils/rbac.ts`) returns a role's active permissions, flattened to codes.
     *
     * Override to swap in an entirely different evaluation strategy — a role hierarchy, a
     * wildcard-expansion policy, an external policy engine — without forking `AuthService`. This
     * behavior lives on `auth.app.ts`
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
})

export default authApp
