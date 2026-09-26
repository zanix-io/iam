import { assertEquals } from 'jsr:@std/assert@0.224'
import { GENERAL_HEADERS } from '@zanix/server'
import type { GuardContext } from '@zanix/server'
import { cookiesAcceptedGuard } from '../../sdk/cookies-accepted-guard.ts'

/** Runs the guard against a request a real server delivers, with the frozen `cookies` object the
 * global cookies guard hands over, and reports what it did. */
async function run(init?: RequestInit & { drainBody?: boolean }) {
  const seen: { caught?: unknown; header?: string | null; method?: string } = {}
  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    if (init?.drainBody) await req.text()
    const ctx = { req, cookies: Object.freeze({}) } as unknown as GuardContext
    try {
      cookiesAcceptedGuard()(ctx)
      seen.header = ctx.req.headers.get(GENERAL_HEADERS.cookiesAcceptedHeader)
      seen.method = ctx.req.method
    } catch (error) {
      seen.caught = error
    }
    return new Response(null, { status: 204 })
  })
  try {
    await fetch(`http://localhost:${server.addr.port}/`, init)
  } finally {
    await server.shutdown()
  }
  return seen
}

Deno.test('cookiesAcceptedGuard: tolerates a real request with immutable headers and frozen cookies', async () => {
  const seen = await run()
  assertEquals(seen.caught, undefined)
  assertEquals(seen.header, 'true')
})

Deno.test('cookiesAcceptedGuard: tolerates a POST whose body was already consumed', async () => {
  const seen = await run({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.com' }),
    drainBody: true,
  })
  assertEquals(seen.caught, undefined)
  assertEquals(seen.header, 'true')
  assertEquals(seen.method, 'POST')
})
