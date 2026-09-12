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
import { resolveThemeOverrides } from 'utils/constants.ts'

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
  // A first, minimal proof that a `@zanix/space` app can declare a `behaviors` slot at all — see
  // `space-styling-and-theming`'s Fix 4a (`theme`, above/below) for env-var-driven VALUE
  // customization (colors, no code); this is the STRUCTURE tier instead — a host composing this
  // app's own manifest (never forking it) can replace the login heading entirely, e.g.
  // `Zanix.start({ apps: { iam: { definition: iamSpaceApp, behaviors: { loginHeading: { ... } } } } } })`.
  // Deliberately just one slot, not a rewrite of every page as swappable — see `login/page.tsx`'s
  // own `LoginView`, the only consumer, for `resolveBehavior`'s own call site.
  behaviors: {
    loginHeading: {
      default: () => 'Sign in',
      description: "The password-login page's own <h1> heading. Override to replace the " +
        'default copy without forking LoginView.',
    },
  },
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
  // Lets a self-hosted instance override this app's own `--space-*` design tokens (brand color,
  // etc.) via one env var (`IAM_THEME`, JSON-valued) — no code, no clone required. See
  // `resolveThemeOverrides`'s own doc for why this is a JSON-in-env-var, not a `--customizations
  // <file>` flag. `space-styling-and-theming`'s own `theme.resolve` is otherwise unused by this
  // project today — no seeded `tokens.css`, so an unset `IAM_THEME` renders with `@zanix/space-ui`'s
  // own defaults, exactly as before this option existed.
  theme: {
    resolve: resolveThemeOverrides,
  },
})

export default iamSpaceApp
