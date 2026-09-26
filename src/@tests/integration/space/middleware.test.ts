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

// `langPreHandler` is registered with `ignorePrefixes` for this project's REST controllers
// (`/login`, `/pwd`, `/users`, `/roles`, `/permissions`, `/grant-access`) so they are never
// redirected to a `/{lang}/...` URL with no route behind it. These assertions call the REAL
// registered preHandler, so removing an entry from `middleware.ts`'s `REST_CONTROLLER_PREFIXES`
// fails here.
Deno.test("space/middleware.ts: does not redirect this project's own REST controller routes", async () => {
  const preHandler = getRealPreHandler()

  const paths = [
    '/api/login/otp/user%40example.com',
    '/api/oauth/authorize?client_id=x',
    '/iam-space/log',
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
Deno.test('space/middleware.ts: redirects an unprefixed Space page to its /{lang}/... URL', async () => {
  const preHandler = getRealPreHandler()

  const response = await preHandler(new Request('http://localhost/consent'), FAKE_SERVE_INFO)
  assertExists(response)
  assertEquals(response.status, 301)
  const location = response.headers.get('Location')
  assertExists(location)
  assertEquals(new URL(location).pathname, '/en/consent')
})

Deno.test('space/middleware.ts: skips framework-internal routes', async () => {
  const preHandler = getRealPreHandler()

  const response = await preHandler(new Request('http://localhost/health'), FAKE_SERVE_INFO)
  assertEquals(response, null)
})

// `cookieConsentBypassGuard` injects `GENERAL_HEADERS.cookiesAcceptedHeader` by reassigning
// `ctx.req` to a cloned `Request` with a mutable `Headers`. It cannot write onto the incoming
// request's `Headers` (a real server request's `Headers` carry the `"immutable"` guard and throw
// `Cannot change headers`) nor into `ctx.cookies` (`@zanix/server`'s built-in `cookiesGuard`
// freezes it before any app guard runs). This test reproduces both constraints together: a real
// `Deno.serve` request for the immutable `Headers`, plus a frozen `cookies` object. It binds a
// real listener, so it belongs in `integration/` (Pattern B in `zanix-test-tier-conventions`).
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

// Cloning with `new Request(ctx.req, { headers })` throws `Input request's body is unusable` once
// the body has been read, and `@zanix/server` reads every JSON/form-urlencoded
// `POST`/`PUT`/`PATCH` body before any guard runs (every login/OTP/TOTP/password-recovery page
// action is such a `POST`). This test drains the request body first, the same way that parsing
// step does, then invokes the guard.
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
