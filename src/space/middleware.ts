import type { GuardContext, MiddlewareGuard } from '@zanix/server'
import { GENERAL_HEADERS } from '@zanix/server'
import { AVAILABLE_LANGS, DEFAULT_LANG } from './constants.ts'
import { isCookieConsentEnabled } from 'utils/constants.ts'
import {
  defineMiddleware,
  definePreHandler,
  langGuard,
  langPreHandler,
  populationGuard,
} from '@zanix/space'

/**
 * This project's own real REST controller prefixes (`@Controller({ prefix: ... })` in
 * `src/server/handlers/*.ts`) — passed to `langPreHandler` below via `ignorePrefixes` so its
 * `/{lang}/...` redirect never intercepts this project's REST API, which lives in a completely
 * separate route space from Space pages and has no `{lang}` counterpart at all. Kept as its own
 * named list (rather than inlined) so a future 7th controller is a one-line addition here, not a
 * re-derivation of `langPreHandler`'s own matching shape. Each entry carries a leading `/` and no
 * trailing one, matching `langPreHandler`'s own `pathname.startsWith(prefix)` check and the exact
 * shape of its built-in `FRAMEWORK_PREFIXES` entries that take the same form (e.g. `/health`).
 */
const REST_CONTROLLER_PREFIXES = [
  '/login',
  '/pwd',
  '/users',
  '/roles',
  '/permissions',
  '/grant-access',
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
 * would silently never run under `dev` (see `space-i18n-and-population`'s own documented footgun).
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
 * **Neither of the two obvious places to inject this actually works, both confirmed live:**
 * - `ctx.req.headers.set(...)` — `ctx.req` is the raw `Request` instance Deno's own server handler
 *   receives, whose `Headers` carry an `"immutable"` guard, so `.set(...)` throws
 *   `TypeError: Cannot change headers: headers are immutable` on every real request. This project's
 *   own former implementation did exactly that, and its unit test only ever passed because it built
 *   `ctx.req` via a bare `new Request(...)`, whose `Headers` guard is `"request"` (mutable), never
 *   reproducing the real server's immutable one.
 * - `ctx.cookies[...] = 'true'` — `cookiesGuard` (`@zanix/server`'s own built-in guard, run before
 *   every app guard, this one included) calls `Object.freeze(ctx.cookies)` right after populating
 *   it. Writing an EXISTING key would silently no-op (or throw in strict mode); writing a key that
 *   isn't already present — exactly this case, since the whole point is a visitor who never sent
 *   `X-Znx-Cookies-Accepted` at all — throws
 *   `TypeError: Cannot add property X-Znx-Cookies-Accepted, object is not extensible`. Confirmed
 *   the same way as the headers case above: a synthetic, non-frozen `ctx.cookies` in a unit test
 *   masks this exactly as a bare mutable `Request` masks the headers guard.
 *
 * The one thing a guard genuinely CAN do is reassign `ctx.req` itself to a brand-new `Request` —
 * the field is a plain, mutable `HandlerContext` property, not a readonly one, and every later
 * guard/pipe/interceptor in the SAME pipeline reads `ctx.req` fresh off the shared context, not a
 * pre-guard snapshot (confirmed: `contextSettingPipe`'s own `ProgramModule.context.addContext(...)`
 * call builds a SEPARATE `ScopedContext` snapshot for scoped DI lookups — it omits `req`/`url`
 * entirely — while `sessionHeadersInterceptor` itself destructures `ctx.req.headers` straight off
 * the SAME shared `HandlerContext` object every guard already mutated, not off that snapshot).
 * `new Request(ctx.req, { headers })` clones the original with a plain mutable `Headers` guard on
 * the clone, so the injected header is both writable now and readable later exactly as
 * `checkAcceptedCookies`'s own `headers.get(cookiesAcceptedHeader)` read (`sessionHeadersInterceptor`,
 * `@zanix/auth`'s own `headers.ts`) expects — with no need to touch the frozen `ctx.cookies` at all.
 *
 * **A real, confirmed second constraint on that clone**: `new Request(ctx.req, ...)` throws
 * `TypeError: Input request's body is unusable` once `ctx.req`'s body has already been read —
 * which, for any `POST`/`PUT`/`PATCH` request with a JSON or `application/x-www-form-urlencoded`
 * body, has ALREADY happened by the time any guard runs at all: `@zanix/server`'s own top-level
 * request handler eagerly reads and parses the body into `ctx.payload.body` before route
 * matching/guards ever start (confirmed live: manually draining `req.body`'s stream, the same way
 * that parsing step does, flips `req.bodyUsed` to `true` and makes the very next `new
 * Request(req, ...)` throw). That is exactly this app's own real, common case — every login/OTP/
 * TOTP/password-recovery Space page action is a `POST` with a body, and `cookieConsentBypassGuard`
 * runs on every one of them project-wide. `ctx.req.bodyUsed` distinguishes the two cases: when
 * `true`, this rebuilds from `url`/`method` alone — nothing downstream can read `ctx.req`'s body a
 * second time either way, since it was already exhausted before this guard ever ran, so dropping it
 * from the clone loses nothing real; when `false` (a `GET` page load, or a body shape this
 * framework doesn't eagerly parse, e.g. `multipart/form-data`), the real body is preserved.
 *
 * A no-op while the modal stays enabled (the default): {@linkcode CookieConsentModal}'s own
 * Accept/Decline round trip already records the real decision in that case, and unconditionally
 * forcing `true` here would silently override an operator's genuine Decline.
 */
export function cookieConsentBypassGuard(): MiddlewareGuard {
  return (ctx: GuardContext) => {
    if (!isCookieConsentEnabled()) {
      const headers = new Headers(ctx.req.headers)
      headers.set(GENERAL_HEADERS.cookiesAcceptedHeader, 'true')
      ctx.req = ctx.req.bodyUsed
        ? new Request(ctx.req.url, { method: ctx.req.method, headers })
        : new Request(ctx.req, { headers })
    }
    return {}
  }
}

/**
 * This project's own space-wide guards — `langGuard` (refreshes the `X-Znx-Lang` cookie for an
 * already-prefixed `/{lang}/...` request; `langPreHandler` above only refreshes it on an actual
 * redirect, so a request reaching a route directly via an already-prefixed link needs this guard to
 * keep the cookie from going stale), `populationGuard` (segment/tenant content-variant
 * resolution — registered even though this project draws no population distinction of its own yet,
 * so the mechanism is already wired the moment one is needed, matching
 * `space-i18n-and-population`'s own recommended pairing), and `cookieConsentBypassGuard` (see its
 * own doc). Safe to register unconditionally: `populationGuard` and `cookieConsentBypassGuard` are
 * both purely additive and never reject a request.
 */
const spaceMiddleware: ReturnType<typeof defineMiddleware> = defineMiddleware([
  langGuard(),
  populationGuard(),
  cookieConsentBypassGuard(),
])

export default spaceMiddleware
