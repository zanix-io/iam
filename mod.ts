import '@zanix/auth/core'
import '@zanix/notifications/core'
import Zanix from '@zanix/core'
import spaceApp from './space.app.ts'
import authApp from './src/server/apps/auth.app.ts'
import grantAccessApp from './src/server/apps/grant-access.app.ts'
import { getBootstrapSpaceAppConfig } from '@zanix/space'

/**
 * iam's entrypoint — bootstraps this project's own REST/GraphQL/socket handlers (auto-
 * discovered from the project root, same as a plain `server` project — this includes
 * `auth`'s own `login.handler.ts`/`password.handler.ts`, and `grant-access`'s own
 * `grant-access.handler.ts`, see `src/server/apps/auth.app.ts`'s and `grant-access.app.ts`'s own
 * docs for why both stay on this path rather than being scoped inside their own app), the `auth`
 * and `grant-access` domain slices' own Zanix Apps (config/resources/behaviors/operations
 * composition, no HTTP surface of their own — `routes: false` on both), AND the `@zanix/space`
 * frontend app scaffolded under `src/space/`, registered as named apps so `Zanix.start()`
 * activates and serves all four from the same process. See `@zanix/core`'s own README for
 * `Zanix.start()`'s full options.
 *
 * `@zanix/auth/core` is imported once, here, for its zero-config wiring: the default
 * `ZanixAuthProvider` under the `'auth'` core-provider key, the session-headers interceptor, and
 * (env-var-gated) the default `GoogleOAuth2Connector`/`GitHubOAuth2Connector` — see
 * `auth-jwt-and-sessions`'s "Core registration" section. `@zanix/notifications/core` is imported
 * the same way, for the `NotifierProvider` (`this.providers.get('notifications')`) `PasswordService`
 * dispatches OTP/recovery codes through — each of `SmtpClient`/`SmsClient`/`WhatsappClient`
 * registers independently, gated on its own env vars (see `notifications-connectors`).
 *
 * `codeTemplatesDiscovery: true` exposes this project's own in-code notification-template
 * catalog under `/.well-known/zanix/code-templates`, mirroring the real, deployed reference this
 * `auth` slice is grounded on (`iam`'s own `main.ts`) — so a central console's own
 * hub can pull/seed its aggregated template catalog from this service (see
 * `notifications-template-storage-modes`/`admin-templates-api`). This project doesn't set
 * `admin: true` (the reference's OWN embedded admin server) — only Discovery, no full admin
 * composition: this deployment serves `auth`/`grant-access` themselves, not a separate admin
 * console for managing other services.
 */
await Zanix.start({
  codeTemplatesDiscovery: true,
  apps: {
    [spaceApp.definition.name]: {
      definition: spaceApp,
      // `rest.globalPrefix` anchored away from the default `'api'`: `defineSpaceApp` always
      // registers its own `POST /api/log` REST route (see `getBootstrapSpaceAppConfig`'s own
      // doc), which otherwise resolves to the exact same dispatch key ("api" on this app's own
      // shared port) as `main`'s real `auth`/`grant-access` REST surface
      // (`/api/login/*`/`/api/users/*`/etc.) registered below — a real, always-present collision
      // this checkout never surfaced before pinning `@zanix/server@4.2.4`+, which made an
      // unconfigured collision a loud boot-time error instead of a silent one-overwrites-the-
      // other route-table bug. Only this space app's own prefix moves; `main`'s own routes
      // (`/api/login/login` and everything else `web`'s own `IamServiceClient` calls) are
      // untouched.
      server: {
        ...getBootstrapSpaceAppConfig().server,
        rest: { ...getBootstrapSpaceAppConfig().server?.rest, globalPrefix: 'iam-space' },
      },
    },
    [authApp.definition.name]: {
      definition: authApp,
    },
    [grantAccessApp.definition.name]: {
      definition: grantAccessApp,
    },
  },
})
