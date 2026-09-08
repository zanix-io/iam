import '@zanix/space/react'
// Registers `langPreHandler`/`langGuard`/`populationGuard` — imported for its side effects, and
// BEFORE `getUserPreHandler()` below, which reads back what this module's own top-level
// `definePreHandler` call just registered. See that file's own doc for why this must be imported
// from here (or another module `space.app.ts` itself imports), never only from `mod.ts`.
import './src/space/middleware.ts'
import type { ZanixAppDefinition } from '@zanix/space'

import {
  createNotFoundHandler,
  defineBootstrapSpaceAppConfig,
  defineSpaceApp,
  getUserPreHandler,
} from '@zanix/space'

defineBootstrapSpaceAppConfig({
  server: {
    ssr: {
      onError: createNotFoundHandler(),
      attachRequestToErrors: true,
      preHandler: getUserPreHandler(),
    },
  },
})

/** This project's `@zanix/space` app definition — frontend routes, assets, and messages for the
 * `iam` login/2FA/password-recovery UI. Registered as a named app alongside `auth`/`grant-access`
 * in `mod.ts`'s own `Zanix.start()` call. */
const iamSpaceApp: ZanixAppDefinition = defineSpaceApp({
  name: 'iam',
  routesDir: './src/space/routes',
  clientBuildDir: './.dist/client',
  assetsDir: './assets',
  messagesDir: './src/space/messages',
  // `cookie-consent-modal.comet.tsx`'s own visual panel styling — GLOBAL, not a page's own `static
  // styles`, because that comet is composed once in the root `[lang]/layout.tsx` and shows on
  // EVERY page (see that layout's own doc for why this project's cookie-consent gate is
  // project-wide rather than per-login-form). `globalCss` resolves through the same no-build,
  // no-dev-mode-flash mechanism a page's own `static styles` uses — see that stylesheet's own doc.
  globalCss: ['./src/space/comets/cookie-consent-modal.css'],
})

export default iamSpaceApp
