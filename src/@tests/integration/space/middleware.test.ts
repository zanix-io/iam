import { assertEquals, assertExists } from 'jsr:@std/assert@0.224'
import { getUserPreHandler } from '@zanix/space'
import { GENERAL_HEADERS } from '@zanix/server'
import type { GuardContext } from '@zanix/server'

// Importing this module for its own side effect — the real `definePreHandler`/`defineMiddleware`
// registration calls `middleware.ts` makes at the top level (see that file's own doc) — is the
// thing under test here, not any internal logic of its own; this is a "correctly wired into the
// real system" check (`zanix-test-tier-conventions`' own Pattern A), which belongs in
// `integration/`, never `unit/`, even though each individual assertion below looks small.
import { cookieConsentBypassGuard } from 'space/middleware.ts'
import { COOKIE_CONSENT_ENABLED_ENV } from 'utils/constants.ts'

/** Fetches the real registered `preHandler`, asserting it exists rather than using a non-null
 * assertion — the previous test in this file already covers the "it's registered at all" case;
 * this just gives every other test in the file a typed, non-`undefined` reference to call. */
function getRealPreHandler() {
  const preHandler = getUserPreHandler()
  assertExists(preHandler)
  return preHandler
}

/** A `PreHandler`'s real second parameter (`Deno.ServeHandlerInfo<Deno.NetAddr>`) — `langPreHandler`
 * itself never reads it, but the real, current `PreHandler` type signature requires it, so a real
 * (if inert) value is passed rather than casting the call away from that contract. */
const FAKE_SERVE_INFO: Deno.ServeHandlerInfo<Deno.NetAddr> = {
  remoteAddr: { transport: 'tcp', hostname: '127.0.0.1', port: 0 },
  completed: Promise.resolve(),
}

Deno.test('space/middleware.ts: registers a real preHandler reachable via getUserPreHandler()', () => {
  const preHandler = getUserPreHandler()
  assertEquals(typeof preHandler, 'function')
})

// Regression coverage for a real, previously-live bug: `langPreHandler` was registered with no
// `ignorePrefixes`, so it 301-redirected every request to this project's own REST controllers
// (`/login`, `/pwd`, `/users`, `/roles`, `/permissions`, `/grant-access`) to a `/{lang}/...` URL
// with no route behind it at all — confirmed live via a real `curl` against `zanix space dev`,
// never caught by a unit test until now. These assertions call the REAL registered preHandler
// (not a re-derivation of `langPreHandler`'s own matching logic), so a future removal of an entry
// from `middleware.ts`'s own `REST_CONTROLLER_PREFIXES` list fails here too, not just in a manual
// `curl` re-check.
Deno.test("space/middleware.ts: does not redirect this project's own REST controller routes", async () => {
  const preHandler = getRealPreHandler()

  const paths = [
    '/login/otp/user%40example.com',
    '/pwd/reset',
    '/users/register',
    '/roles',
    '/permissions',
    '/grant-access',
  ]
  const responses = await Promise.all(
    paths.map((path) => preHandler(new Request(`http://localhost${path}`), FAKE_SERVE_INFO)),
  )
  responses.forEach((response, index) => {
    assertEquals(response, null, `expected ${paths[index]} to fall through unredirected`)
  })
})

// `/consent` (a real Space page under `routes/[lang]/consent`) is used here rather than `/login`
// deliberately: this project's own `login` REST controller and its `login` Space page share that
// same top-level segment, so an unprefixed `/login` is now ambiguous by design (falls through to
// REST dispatch per `REST_CONTROLLER_PREFIXES` above) — `/consent` has no such collision, so it's
// the unambiguous case for "an ordinary Space page still gets its `/{lang}/...` redirect".
Deno.test('space/middleware.ts: still redirects an unprefixed Space page to its /{lang}/... URL', async () => {
  const preHandler = getRealPreHandler()

  const response = await preHandler(new Request('http://localhost/consent'), FAKE_SERVE_INFO)
  assertExists(response)
  assertEquals(response.status, 301)
  const location = response.headers.get('Location')
  assertExists(location)
  assertEquals(new URL(location).pathname, '/en/consent')
})

Deno.test('space/middleware.ts: still skips framework-internal routes untouched by this fix', async () => {
  const preHandler = getRealPreHandler()

  const response = await preHandler(new Request('http://localhost/health'), FAKE_SERVE_INFO)
  assertEquals(response, null)
})

// Regression coverage for a real, previously-live bug — with a second, real regression already
// caught behind it before this ever reached production: `cookieConsentBypassGuard` first tried
// writing `GENERAL_HEADERS.cookiesAcceptedHeader` onto `ctx.req.headers` directly. That passed its
// own unit test (built against a bare `new Request(...)`, whose `Headers` carry the mutable
// `"request"` guard) but throws `TypeError: Cannot change headers: headers are immutable` against
// a REAL server request, whose `Headers` carry the `"immutable"` guard instead. The next attempt
// wrote into `ctx.cookies` instead — but `@zanix/server`'s own built-in `cookiesGuard` (run before
// every app guard) `Object.freeze`s `ctx.cookies`, so THAT throws
// `TypeError: Cannot add property ..., object is not extensible` for exactly the case this guard
// exists for (no `X-Znx-Cookies-Accepted` key present at all yet). The real fix reassigns `ctx.req`
// to a freshly cloned `Request` carrying the injected header on a mutable `Headers` instance
// instead of mutating either the original `Headers` or the frozen `cookies` object — this test
// reproduces BOTH real constraints together (a genuine `Deno.serve` request for the immutable
// `Headers`, plus a frozen `cookies` object for the frozen-cookies case) since neither one alone
// reproduces the other (`zanix-test-tier-conventions`' own Pattern B: a real server dependency
// belongs in `integration/`, never `unit/`).
Deno.test(
  "space/middleware.ts: cookieConsentBypassGuard tolerates a real request's immutable Headers " +
    'and a frozen ctx.cookies',
  async () => {
    const original = Deno.env.get(COOKIE_CONSENT_ENABLED_ENV)
    Deno.env.set(COOKIE_CONSENT_ENABLED_ENV, 'false')

    let caught: unknown
    let headerValue: string | null = null
    const server = Deno.serve({ port: 0, onListen: () => {} }, (req) => {
      // Mirrors real production ordering: `cookiesGuard` runs BEFORE any app guard and hands over
      // an already-frozen `cookies` object.
      const ctx = { req, cookies: Object.freeze({}) } as unknown as GuardContext
      try {
        cookieConsentBypassGuard()(ctx)
        headerValue = ctx.req.headers.get(GENERAL_HEADERS.cookiesAcceptedHeader)
      } catch (error) {
        caught = error
      }
      return new Response(null, { status: 204 })
    })

    try {
      await fetch(`http://localhost:${server.addr.port}/`)
    } finally {
      await server.shutdown()
      if (original === undefined) Deno.env.delete(COOKIE_CONSENT_ENABLED_ENV)
      else Deno.env.set(COOKIE_CONSENT_ENABLED_ENV, original)
    }

    assertEquals(caught, undefined)
    assertEquals(headerValue, 'true')
  },
)

// Regression coverage for a THIRD real, previously-live bug in the same fix above: the
// `new Request(ctx.req, { headers })` clone itself throws
// `TypeError: Input request's body is unusable` once `ctx.req`'s body has already been read —
// which `@zanix/server`'s own request handler does globally, for every `POST`/`PUT`/`PATCH` request
// carrying a JSON or `application/x-www-form-urlencoded` body, BEFORE any guard (this one included)
// ever runs. That's this project's own real, common case: every login/OTP/TOTP/password-recovery
// Space page action is exactly such a `POST`. This test drains the request body first — the same
// way that framework-level parsing step does — before invoking the guard, to prove it survives an
// ALREADY-CONSUMED body rather than only ever being exercised against a bodyless `GET`.
Deno.test(
  'space/middleware.ts: cookieConsentBypassGuard tolerates a POST request whose body was already ' +
    'consumed before the guard ran',
  async () => {
    const original = Deno.env.get(COOKIE_CONSENT_ENABLED_ENV)
    Deno.env.set(COOKIE_CONSENT_ENABLED_ENV, 'false')

    let caught: unknown
    let headerValue: string | null = null
    let methodPreserved: string | undefined
    const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
      // Mirrors `bodyPayloadProperty` (`@zanix/server`) draining the body before any guard runs —
      // `.text()` disturbs/consumes the body exactly the same way that function's own
      // `readBoundedStream` reader does, without a manual read loop here.
      await req.text()

      const ctx = { req, cookies: Object.freeze({}) } as unknown as GuardContext
      try {
        cookieConsentBypassGuard()(ctx)
        headerValue = ctx.req.headers.get(GENERAL_HEADERS.cookiesAcceptedHeader)
        methodPreserved = ctx.req.method
      } catch (error) {
        caught = error
      }
      return new Response(null, { status: 204 })
    })

    try {
      await fetch(`http://localhost:${server.addr.port}/en/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.com', password: 'x' }),
      })
    } finally {
      await server.shutdown()
      if (original === undefined) Deno.env.delete(COOKIE_CONSENT_ENABLED_ENV)
      else Deno.env.set(COOKIE_CONSENT_ENABLED_ENV, original)
    }

    assertEquals(caught, undefined)
    assertEquals(headerValue, 'true')
    assertEquals(methodPreserved, 'POST')
  },
)
