import { assertEquals } from 'jsr:@std/assert@0.224'
import type { GuardContext } from '@zanix/server'
import { createJWT, JWT_KEY_ENV } from '@zanix/auth'

import { refreshRateLimitIdentityGuard } from 'utils/refresh-rate-limit-guard.ts'

const TOKEN_HEADER = 'X-Znx-App-Token'

function withEnv<T>(name: string, value: string, run: () => Promise<T> | T): Promise<T> {
  const original = Deno.env.get(name)
  Deno.env.set(name, value)
  return (async () => {
    try {
      return await run()
    } finally {
      if (original === undefined) Deno.env.delete(name)
      else Deno.env.set(name, original)
    }
  })()
}

/** Minimal `GuardContext` stand-in — the guard only ever reads `req.headers`/`cookies` and writes
 * `locals`, so nothing else needs a real shape. */
function mockGuardContext(
  { headers = {}, cookies = {} }: {
    headers?: Record<string, string>
    cookies?: Record<string, string>
  },
): GuardContext {
  return {
    req: { headers: new Headers(headers) },
    cookies,
    locals: {},
  } as unknown as GuardContext
}

const TEST_JWT_KEY = 'test-jwt-key'

async function mintToken(sub: string): Promise<string> {
  return await withEnv(
    JWT_KEY_ENV,
    TEST_JWT_KEY,
    () => createJWT({ sub }, TEST_JWT_KEY, {}),
  )
}

Deno.test('refreshRateLimitIdentityGuard: populates ctx.locals.session from the header', async () => {
  const token = await mintToken('user-1')
  const ctx = mockGuardContext({ headers: { [TOKEN_HEADER]: token } })
  await refreshRateLimitIdentityGuard()(ctx)
  assertEquals(ctx.locals.session, { id: 'user-1', type: 'user', rateLimit: 1 })
})

Deno.test('refreshRateLimitIdentityGuard: falls back to the cookie when no header is present', async () => {
  const token = await mintToken('user-2')
  const ctx = mockGuardContext({ cookies: { [TOKEN_HEADER]: token } })
  await refreshRateLimitIdentityGuard()(ctx)
  assertEquals(ctx.locals.session?.id, 'user-2')
})

Deno.test('refreshRateLimitIdentityGuard: the header wins when both header and cookie are present', async () => {
  const headerToken = await mintToken('header-user')
  const cookieToken = await mintToken('cookie-user')
  const ctx = mockGuardContext({
    headers: { [TOKEN_HEADER]: headerToken },
    cookies: { [TOKEN_HEADER]: cookieToken },
  })
  await refreshRateLimitIdentityGuard()(ctx)
  assertEquals(ctx.locals.session?.id, 'header-user')
})

Deno.test('refreshRateLimitIdentityGuard: leaves ctx.locals.session unset with no token at all', async () => {
  const ctx = mockGuardContext({})
  await refreshRateLimitIdentityGuard()(ctx)
  assertEquals(ctx.locals.session, undefined)
})

Deno.test('refreshRateLimitIdentityGuard: an undecodable token falls through, no throw', async () => {
  const ctx = mockGuardContext({ headers: { [TOKEN_HEADER]: 'not-a-real-jwt' } })
  await refreshRateLimitIdentityGuard()(ctx)
  assertEquals(ctx.locals.session, undefined)
})
