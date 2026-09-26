import '@zanix/auth/core'
import '@zanix/notifications/core'
import Zanix from '@zanix/core'
import spaceApp from './space.app.ts'
import authApp from './src/server/apps/auth.app.ts'
import grantAccessApp from './src/server/apps/grant-access.app.ts'
import { getBootstrapSpaceAppConfig } from '@zanix/space'

/**
 * iam's entrypoint — bootstraps this project's own REST/GraphQL/socket handlers (auto-discovered
 * from the project root, same as a plain `server` project; this includes `login.handler.ts`,
 * `password.handler.ts` and `grant-access.handler.ts` — see `src/server/apps/auth.app.ts`'s and
 * `grant-access.app.ts`'s own docs for why they stay on this path rather than being scoped inside
 * their own app), the `auth` and `grant-access` Zanix Apps (config/resources/behaviors/operations
 * composition, no HTTP surface of their own — `routes: false` on both), AND the `@zanix/space`
 * frontend app under `src/space/`, registered as named apps so `Zanix.start()` activates and
 * serves all of them from the same process. See `@zanix/core`'s own README for `Zanix.start()`'s
 * full options.
 *
 * `@zanix/auth/core` is imported once, here, for its zero-config wiring: the default
 * `ZanixAuthProvider` under the `'auth'` core-provider key, the session-headers interceptor, and
 * (env-var-gated) the default `GoogleOAuth2Connector`/`GitHubOAuth2Connector` — see
 * `@zanix/auth`'s README. `@zanix/notifications/core` is imported the same way, for the
 * `NotifierProvider` (`this.providers.get('notifications')`) `PasswordService` dispatches
 * OTP/recovery codes through — each of `SmtpClient`/`SmsClient`/`WhatsappClient` registers
 * independently, gated on its own env vars (see `@zanix/notifications`'s README).
 *
 * `codeTemplatesDiscovery: true` exposes this project's own in-code notification-template catalog
 * under `/.well-known/zanix/code-templates`, so a central console can pull/seed its aggregated
 * template catalog from this service. `admin: true` (an embedded admin server) stays off — this
 * deployment serves `auth`/`grant-access` themselves, not an admin console for other services.
 */
await Zanix.start({
  codeTemplatesDiscovery: true,
  apps: {
    [spaceApp.definition.name]: {
      definition: spaceApp,
      // `rest.globalPrefix` anchored away from the default `'api'`: `defineSpaceApp` always
      // registers its own `POST /api/log` REST route (see `getBootstrapSpaceAppConfig`'s own
      // doc), which otherwise resolves to the exact same dispatch key ("api" on the shared port)
      // as `main`'s `auth`/`grant-access` REST surface (`/api/login/*`/`/api/users/*`/etc.)
      // registered below — `@zanix/server` rejects that collision at boot. Only this space app's
      // own prefix moves; `main`'s own routes (`/api/login/login` and everything else a consumer
      // app's `IamServiceClient` calls) are untouched.
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
