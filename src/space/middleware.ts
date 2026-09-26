import type { GuardContext, MiddlewareGuard } from '@zanix/server'
import { markCookiesAccepted } from '@zanix/auth'
import { AVAILABLE_LANGS, DEFAULT_LANG } from './constants.ts'
import { isCookieConsentEnabled, REST_API_PREFIX } from 'utils/constants.ts'
import {
  defineMiddleware,
  definePreHandler,
  langGuard,
  langPreHandler,
  populationGuard,
} from '@zanix/space'

/**
 * Path prefixes `langPreHandler` must never redirect to a `/{lang}/...` URL, passed to it below as
 * `ignorePrefixes`. The pre-handler wraps every request on the shared port, so without this list it
 * also redirects REST calls, which have no `{lang}` counterpart:
 * - {@linkcode REST_API_PREFIX}: where `mod.ts` serves every REST route, including the
 *   `/api/oauth/authorize` return target `OAuthProviderService.authorize` sends through the login
 *   page.
 * - `/iam-space`: the space app's own REST prefix (`mod.ts`), e.g. `POST /iam-space/log`.
 * - The bare controller prefixes (`@Controller({ prefix })` in `src/server/handlers/*.ts`): the
 *   unprefixed paths REST routes resolve to when no global prefix applies.
 *
 * Each entry has a leading `/` and no trailing one, matching `langPreHandler`'s
 * `pathname.startsWith(prefix)` check.
 */
const REST_CONTROLLER_PREFIXES = [
  REST_API_PREFIX,
  '/iam-space',
  '/login',
  '/pwd',
  '/users',
  '/roles',
  '/permissions',
  '/grant-access',
  '/oauth',
]

/**
 * Registers this project's own `/{lang}/...` prefix routing — `langPreHandler` (redirects an
 * unprefixed request to its resolved `{lang}` prefix, setting the `X-Znx-Lang` cookie) — via
 * `definePreHandler`, so `space.app.ts`'s own `getUserPreHandler()` call (its
 * `defineBootstrapSpaceAppConfig({ server: { ssr: { preHandler } } })`) picks it up.
 *
 * **Import order matters**: this module must be imported by `space.app.ts` BEFORE it calls
 * `getUserPreHandler()` — `definePreHandler` below registers into the SAME module-level registry
 * `getUserPreHandler()` reads back synchronously, so the read must happen after this file's own
 * top-level `definePreHandler` call has already run.
 *
 * Registered from `space.app.ts` (via this module), never only passed to `mod.ts`'s own bootstrap
 * call — `zanix space dev` never imports `mod.ts` at all, so a `preHandler` declared only there
 * would silently never run under `dev`.
 *
 * `ignorePrefixes` is set to {@linkcode REST_CONTROLLER_PREFIXES} — without it, `langPreHandler`
 * 301-redirects EVERY request to this project's own REST API (e.g. `POST /users/register`) to a
 * `/{lang}/...` URL with no real route behind it, since REST controllers and Space pages are
 * separate route spaces; `ignorePrefixes` extends `langPreHandler`'s own built-in framework-route
 * list, it doesn't replace it, so `/health`/`/ready`/etc. stay skipped too.
 */
definePreHandler(
  langPreHandler({
    availableLangs: [...AVAILABLE_LANGS],
    defaultLang: DEFAULT_LANG,
    ignorePrefixes: REST_CONTROLLER_PREFIXES,
  }),
)

/**
 * Keeps `@zanix/auth`'s own `checkAcceptedCookies` resolving `true` when this project's
 * project-wide cookie-consent modal (`CookieConsentModal`, see `[lang]/layout.tsx`'s own doc) is
 * turned off via `COOKIE_CONSENT_ENABLED_ENV` (`utils/constants.ts`'s own
 * `isCookieConsentEnabled`). With no modal ever recording a real decision,
 * `checkAcceptedCookies` would otherwise keep resolving `false` forever, and
 * `sessionHeadersInterceptor` would never emit a session `Set-Cookie` on any real login.
 *
 * The actual injection is `@zanix/auth`'s own `markCookiesAccepted` — see that function's own doc
 * for the full mechanism (why a `Set-Cookie` here can never help THIS request, and why the two more
 * obvious ways to attach the signal both throw on a real request).
 *
 * A no-op while the modal stays enabled (the default): {@linkcode CookieConsentModal}'s own
 * Accept/Decline round trip already records the real decision in that case, and unconditionally
 * forcing `true` here would silently override an operator's genuine Decline.
 */
export function cookieConsentBypassGuard(): MiddlewareGuard {
  return (ctx: GuardContext) => {
    if (!isCookieConsentEnabled()) markCookiesAccepted(ctx)
    return {}
  }
}

/**
 * This project's own space-wide guards — `langGuard` (refreshes the `X-Znx-Lang` cookie for an
 * already-prefixed `/{lang}/...` request; `langPreHandler` above only refreshes it on an actual
 * redirect, so a request reaching a route directly via an already-prefixed link needs this guard to
 * keep the cookie from going stale), `populationGuard` (segment/tenant content-variant
 * resolution — registered even though this project draws no population distinction of its own, so
 * the mechanism is already wired the moment one is needed), and `cookieConsentBypassGuard` (see its
 * own doc). Safe to register unconditionally: `populationGuard` and `cookieConsentBypassGuard` are
 * both purely additive and never reject a request.
 */
const spaceMiddleware: ReturnType<typeof defineMiddleware> = defineMiddleware([
  langGuard(),
  populationGuard(),
  cookieConsentBypassGuard(),
])

export default spaceMiddleware
