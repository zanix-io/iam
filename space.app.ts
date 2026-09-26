import '@zanix/space/react'
// Registers `langPreHandler`/`langGuard`/`populationGuard` — imported for its side effects, and
// BEFORE `getUserPreHandler()` below, which reads back what this module's own top-level
// `definePreHandler` call just registered. See that file's own doc for why this must be imported
// from here (or another module `space.app.ts` itself imports), never only from `mod.ts`.
import { iamMessages } from './ui/sdk/messages.ts'
import { iamCssSource } from './ui/styles.ts'
import './src/space/middleware.ts'
import type { ZanixAppDefinition } from '@zanix/space'

import {
  createNotFoundHandler,
  defineBootstrapSpaceAppConfig,
  defineSpaceApp,
  getUserPreHandler,
  globalErrorHandler,
  redirectCsrfFailure,
} from '@zanix/space'
import { resolveThemeOverrides } from 'utils/constants.ts'

// `redirectCsrfFailure()` (`@zanix/space`) turns a stale/missing double-submit token (a cached
// form from an earlier page load, a browser back-button resubmission) into a redirect back to the
// same url as a fresh `GET` — re-issuing a valid token so the visitor just resubmits — instead of
// `@zanix/server`'s raw JSON error body reaching a real browser navigation on any of this
// project's own `@Guard(csrfGuard())` pages (`login/page.tsx`, `login/otp/[email]/page.tsx`,
// `login/[oauth]/page.tsx`, `login/totp/[email]/page.tsx`, `totp/enroll/page.tsx`,
// `totp/confirm/page.tsx`, `password/recovery/callback/page.tsx`).
defineBootstrapSpaceAppConfig({
  server: {
    ssr: {
      onError: globalErrorHandler(redirectCsrfFailure(), createNotFoundHandler()),
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
  // One `behaviors` slot — `theme` (below) covers env-var-driven VALUE customization (colors, no
  // code); this is the STRUCTURE tier instead — a host composing this
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
  // The hosted pages read the same catalogs `@zanix/iam/ui/sdk/messages` ships to every consumer.
  messageSources: [iamMessages],
  // The default styles of `iam`'s own views, placed ahead of `globalCss`.
  cssSources: [iamCssSource],
  // `cookie-consent-modal.comet.tsx`'s own visual panel styling — GLOBAL, not a page's own `static
  // styles`, because that comet is composed once in the root `[lang]/layout.tsx` and shows on
  // EVERY page (see that layout's own doc for why this project's cookie-consent gate is
  // project-wide rather than per-login-form). `globalCss` resolves through the same no-build,
  // no-dev-mode-flash mechanism a page's own `static styles` uses — see that stylesheet's own doc.
  globalCss: ['./src/space/comets/cookie-consent-modal.css'],
  // Lets a self-hosted instance override this app's own `--space-*` design tokens (brand color,
  // etc.) via one env var (`IAM_THEME`, JSON-valued) — no code, no clone required. See
  // `resolveThemeOverrides`'s own doc for why this is a JSON-in-env-var, not a `--customizations
  // <file>` flag. This project seeds no `tokens.css` of its own, so an unset `IAM_THEME` renders
  // with `@zanix/space-ui`'s own defaults.
  theme: {
    resolve: resolveThemeOverrides,
  },
})

export default iamSpaceApp
