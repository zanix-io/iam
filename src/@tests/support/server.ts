/**
 * Entry point of the REAL iam REST server used by the end-to-end tests: `mod.ts` without the
 * `@zanix/space` frontend, so it starts fast and serves exactly the controllers `iam` registers
 * (`/api/login`, `/api/roles`, `/api/users`, `/api/permissions`, `/api/audit`, ...). The tests start
 * it as a child process (`helpers/e2e.ts`) with its own environment and throw-away database.
 */
import '@zanix/auth/core'
import '@zanix/notifications/core'
import Zanix from '@zanix/core'
import authApp from '../../server/apps/auth.app.ts'
import grantAccessApp from '../../server/apps/grant-access.app.ts'

await Zanix.start({
  codeTemplatesDiscovery: true,
  apps: {
    [authApp.definition.name]: { definition: authApp },
    [grantAccessApp.definition.name]: { definition: grantAccessApp },
  },
})
