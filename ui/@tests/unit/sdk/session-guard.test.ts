import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'
import type { GuardContext, ZanixCacheProvider } from '@zanix/server'
import { RestClientError, SESSION_HEADERS } from '@zanix/server'

import {
  getOrRefreshIamTokens,
  iamOptionalSessionGuard,
  iamSessionGuard,
  type IamSessionGuardOptions,
  seedIamSessionCache,
} from '../../../sdk/session-guard.ts'
import type { LoginClient } from '../../../sdk/client/login.client.ts'
import type { RefreshResult } from '../../../sdk/rtos/login.ts'

/**
 * Every test below fakes the exact narrow surface `session-guard.ts` actually reads — a real
 * `ZanixCacheProvider`/`GuardContext`/`LoginClient` pulls in a full Zanix runtime this SDK is
 * deliberately built to work without (see this module's own top doc).
 */

// A fresh, never-reused subject/token-id pair per test — `getOrRefreshIamTokens`'s own
// `inFlightRefreshes` map is MODULE-level state shared across every `Deno.test` in this file, so
// two tests sharing a literal `(subject, tokenId)` pair can race each other's async cleanup and
// trip Deno's op sanitizer ("Promise resolution is still pending") even though each test is
// correct in isolation. A unique pair per test keeps every test's cache/dedup state fully
// partitioned from every other's.
let uniqueCounter = 0
function unique(label: string): string {
  return `${label}-${++uniqueCounter}`
}

// A JWT this module can decode: `{sub, jti}` payload, no real signature needed — every real
// verification happens inside `refresh()` itself, never by this module.
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '')
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`
}

function fakeCacheProvider(): ZanixCacheProvider & { _localStore: Map<string, unknown> } {
  const localStore = new Map<string, unknown>()
  const local = {
    get: (key: string) => localStore.get(key),
    set: (key: string, value: unknown) => {
      localStore.set(key, value)
      return true
    },
  }
  return {
    local,
    redis: local,
    _localStore: localStore,
  } as unknown as ZanixCacheProvider & { _localStore: Map<string, unknown> }
}

function fakeGuardContext(
  cache: ZanixCacheProvider,
  cookieToken: string | undefined,
): GuardContext {
  const locals: { session?: Record<string, unknown> } = {}
  return {
    cookies: cookieToken === undefined ? {} : { [SESSION_COOKIE_NAME]: cookieToken },
    locals,
    providers: { get: () => cache } as unknown as GuardContext['providers'],
  } as unknown as GuardContext
}

// The exact same cookie name `session-guard.ts` itself reads via `SESSION_HEADERS.user.token`.
const SESSION_COOKIE_NAME = SESSION_HEADERS.user.token as string

function fakeLoginClient(refresh: LoginClient['refresh']): LoginClient {
  return { refresh } as unknown as LoginClient
}

function refreshResult(subject: string, overrides: Partial<RefreshResult> = {}): RefreshResult {
  return {
    accessToken: fakeJwt({ sub: subject }),
    refreshToken: fakeJwt({ sub: subject, jti: unique('jti') }),
    expiresAt: 3600,
    ...overrides,
  }
}

// ---- getOrRefreshIamTokens ----

Deno.test('getOrRefreshIamTokens: a cache miss calls refresh() and caches the result', async () => {
  const cache = fakeCacheProvider()
  const subject = unique('user')
  const tokens = refreshResult(subject)
  let calls = 0
  const refresh = () => {
    calls++
    return Promise.resolve(tokens)
  }
  const token = fakeJwt({ sub: subject, jti: unique('jti') })

  const result = await getOrRefreshIamTokens(cache, subject, token, refresh)

  assertEquals(calls, 1)
  assertEquals(result.accessToken, tokens.accessToken)
})

Deno.test('getOrRefreshIamTokens: a cache hit never calls refresh() again', async () => {
  const cache = fakeCacheProvider()
  const subject = unique('user')
  let calls = 0
  const refresh = () => {
    calls++
    return Promise.resolve(refreshResult(subject))
  }
  const token = fakeJwt({ sub: subject, jti: unique('jti') })

  await getOrRefreshIamTokens(cache, subject, token, refresh)
  await getOrRefreshIamTokens(cache, subject, token, refresh)

  assertEquals(calls, 1)
})

Deno.test('getOrRefreshIamTokens: concurrent callers for the SAME key single-flight into one refresh() call', async () => {
  const cache = fakeCacheProvider()
  const subject = unique('user')
  let calls = 0
  // Captured ONCE, synchronously, before either call below — `refresh()` itself only actually
  // runs once `getOrRefreshIamTokens`'s own internal `await`s resolve, which happens strictly
  // AFTER this test function's own synchronous portion (creating `p1`/`p2`) already returned.
  // Resolving inside `refresh()`'s own executor would race that timing for real.
  let resolveRefresh: (v: RefreshResult) => void = () => {}
  const pending = new Promise<RefreshResult>((resolve) => {
    resolveRefresh = resolve
  })
  const refresh = () => {
    calls++
    return pending
  }
  const token = fakeJwt({ sub: subject, jti: unique('jti') })

  const p1 = getOrRefreshIamTokens(cache, subject, token, refresh)
  const p2 = getOrRefreshIamTokens(cache, subject, token, refresh)

  resolveRefresh(refreshResult(subject))
  const [r1, r2] = await Promise.all([p1, p2])

  assertEquals(
    calls,
    1,
    'a second concurrent caller for the identical key must never call refresh() itself',
  )
  assertEquals(r1, r2)
})

Deno.test('getOrRefreshIamTokens: rotation caches the result under BOTH the presented and the rotated token id', async () => {
  const cache = fakeCacheProvider()
  const subject = unique('user')
  const presentedId = unique('presented')
  const rotatedId = unique('rotated')
  const presented = fakeJwt({ sub: subject, jti: presentedId })
  const rotated = refreshResult(subject, {
    refreshToken: fakeJwt({ sub: subject, jti: rotatedId }),
  })
  const refresh = () => Promise.resolve(rotated)

  await getOrRefreshIamTokens(cache, subject, presented, refresh)

  assertEquals(cache._localStore.get(`iam-session-guard:${subject}:${presentedId}`), rotated)
  assertEquals(cache._localStore.get(`iam-session-guard:${subject}:${rotatedId}`), rotated)
})

Deno.test('getOrRefreshIamTokens: an undecodable presented token falls straight through to an uncached refresh()', async () => {
  const cache = fakeCacheProvider()
  const subject = unique('user')
  let calls = 0
  const refresh = () => {
    calls++
    return Promise.resolve(refreshResult(subject))
  }

  await getOrRefreshIamTokens(cache, subject, 'not-a-jwt', refresh)
  await getOrRefreshIamTokens(cache, subject, 'not-a-jwt', refresh)

  assertEquals(
    calls,
    2,
    'nothing was ever cached for an undecodable token, so every call is a real refresh()',
  )
})

// ---- seedIamSessionCache ----

Deno.test('seedIamSessionCache: writes the pair under the exact key getOrRefreshIamTokens reads from', async () => {
  const cache = fakeCacheProvider()
  const subject = unique('user')
  const tokens = refreshResult(subject)

  await seedIamSessionCache(cache, subject, tokens)

  let refreshCalls = 0
  const refresh = () => {
    refreshCalls++
    return Promise.resolve(tokens)
  }
  const result = await getOrRefreshIamTokens(cache, subject, tokens.refreshToken, refresh)

  assertEquals(refreshCalls, 0, 'the seeded entry must be served without ever calling refresh()')
  assertEquals(result, tokens)
})

Deno.test('seedIamSessionCache: a no-op on an undecodable refresh token', async () => {
  const cache = fakeCacheProvider()
  const subject = unique('user')
  await seedIamSessionCache(cache, subject, refreshResult(subject, { refreshToken: 'not-a-jwt' }))
  assertEquals(cache._localStore.size, 0)
})

// ---- iamSessionGuard ----

Deno.test('iamSessionGuard: no session cookie throws UNAUTHORIZED with code NO_SESSION_COOKIE', async () => {
  const cache = fakeCacheProvider()
  const subject = unique('user')
  const ctx = fakeGuardContext(cache, undefined)
  const options: IamSessionGuardOptions = {
    loginClient: fakeLoginClient(() => Promise.resolve(refreshResult(subject))),
  }
  const guard = iamSessionGuard([], options)

  const error = await assertRejects(
    async () => {
      await guard(ctx)
    },
    HttpError,
    'No session cookie present',
  )
  // `redirect-unauthorized.ts`'s `IamUnauthorizedReason` mapping reads this exact `code` to tell
  // "never had a session" apart from "had one, it expired", so the discriminator itself is
  // asserted, not just the generic `HttpError`.
  assertEquals((error as unknown as { code: string }).code, 'NO_SESSION_COOKIE')
})

Deno.test('iamSessionGuard: a valid session applies the refreshed tokens and lets the request through', async () => {
  const cache = fakeCacheProvider()
  const subject = unique('user')
  const tokens = refreshResult(subject)
  const token = fakeJwt({ sub: subject, jti: unique('jti') })
  const ctx = fakeGuardContext(cache, token)
  const options: IamSessionGuardOptions = {
    loginClient: fakeLoginClient(() => Promise.resolve(tokens)),
  }
  const guard = iamSessionGuard([], options)

  const result = await guard(ctx)

  assertEquals(result, {})
  assertEquals(
    (ctx.locals.session as unknown as { accessToken: string }).accessToken,
    tokens.accessToken,
  )
})

Deno.test('iamSessionGuard: a rejected refresh() throws UNAUTHORIZED with the original error as cause, code SESSION_REFRESH_FAILED', async () => {
  const cache = fakeCacheProvider()
  const subject = unique('user')
  const token = fakeJwt({ sub: subject, jti: unique('jti') })
  const ctx = fakeGuardContext(cache, token)
  const upstream = new Error('token revoked')
  const options: IamSessionGuardOptions = {
    loginClient: fakeLoginClient(() => Promise.reject(upstream)),
  }
  const guard = iamSessionGuard([], options)

  const error = await assertRejects(async () => {
    await guard(ctx)
  }, HttpError)
  assertEquals(error.cause, upstream)
  // Same real consumer dependency as the no-cookie case above — this is the OTHER half of the
  // discriminator (`code: 'SESSION_REFRESH_FAILED'`), a real cookie that turned out invalid.
  assertEquals((error as unknown as { code: string }).code, 'SESSION_REFRESH_FAILED')
})

Deno.test('iamSessionGuard: a 429 from refresh() is re-thrown UNCHANGED, never collapsed into UNAUTHORIZED', async () => {
  const cache = fakeCacheProvider()
  const subject = unique('user')
  const token = fakeJwt({ sub: subject, jti: unique('jti') })
  const ctx = fakeGuardContext(cache, token)
  const rateLimited = new RestClientError('BAD_GATEWAY', {
    meta: { source: 'zanix', upstreamStatus: 429 },
  })
  const options: IamSessionGuardOptions = {
    loginClient: fakeLoginClient(() => Promise.reject(rateLimited)),
  }
  const guard = iamSessionGuard([], options)

  const error = await assertRejects(async () => {
    await guard(ctx)
  })
  assert(error === rateLimited, 'the exact 429 RestClientError must reach the caller unchanged')
})

Deno.test('iamSessionGuard: a permission failure after a successful refresh still rejects the request', async () => {
  const cache = fakeCacheProvider()
  const subject = unique('user')
  const token = fakeJwt({ sub: subject, jti: unique('jti') })
  const ctx = fakeGuardContext(cache, token)
  const options: IamSessionGuardOptions = {
    loginClient: fakeLoginClient(() => Promise.resolve(refreshResult(subject))),
  }
  const guard = iamSessionGuard(['admin'], options)

  // No `scope` on the applied session — `permissionsPipe(['admin'])` must reject it.
  await assertRejects(async () => {
    await guard(ctx)
  }, HttpError)
})

// ---- iamOptionalSessionGuard ----

Deno.test('iamOptionalSessionGuard: no cookie resolves anonymous, never throws', async () => {
  const cache = fakeCacheProvider()
  const subject = unique('user')
  const ctx = fakeGuardContext(cache, undefined)
  const options: IamSessionGuardOptions = {
    loginClient: fakeLoginClient(() => Promise.resolve(refreshResult(subject))),
  }
  const guard = iamOptionalSessionGuard(options)

  const result = await guard(ctx)

  assertEquals(result, {})
  assertEquals(ctx.locals.session, undefined)
})

Deno.test('iamOptionalSessionGuard: a valid session applies the refreshed tokens', async () => {
  const cache = fakeCacheProvider()
  const subject = unique('user')
  const tokens = refreshResult(subject)
  const token = fakeJwt({ sub: subject, jti: unique('jti') })
  const ctx = fakeGuardContext(cache, token)
  const options: IamSessionGuardOptions = {
    loginClient: fakeLoginClient(() => Promise.resolve(tokens)),
  }
  const guard = iamOptionalSessionGuard(options)

  await guard(ctx)

  assertEquals(
    (ctx.locals.session as unknown as { accessToken: string }).accessToken,
    tokens.accessToken,
  )
})

Deno.test('iamOptionalSessionGuard: a rejected refresh() resolves anonymous instead of throwing', async () => {
  const cache = fakeCacheProvider()
  const subject = unique('user')
  const token = fakeJwt({ sub: subject, jti: unique('jti') })
  const ctx = fakeGuardContext(cache, token)
  const options: IamSessionGuardOptions = {
    loginClient: fakeLoginClient(() => Promise.reject(new Error('nope'))),
  }
  const guard = iamOptionalSessionGuard(options)

  const result = await guard(ctx)

  assertEquals(result, {})
  assertEquals(ctx.locals.session, undefined)
})

Deno.test('iamOptionalSessionGuard: even a 429 rate-limit resolves anonymous, never throws — the documented tradeoff vs iamSessionGuard', async () => {
  const cache = fakeCacheProvider()
  const subject = unique('user')
  const token = fakeJwt({ sub: subject, jti: unique('jti') })
  const ctx = fakeGuardContext(cache, token)
  const rateLimited = new RestClientError('BAD_GATEWAY', {
    meta: { source: 'zanix', upstreamStatus: 429 },
  })
  const options: IamSessionGuardOptions = {
    loginClient: fakeLoginClient(() => Promise.reject(rateLimited)),
  }
  const guard = iamOptionalSessionGuard(options)

  const result = await guard(ctx)
  assertEquals(result, {})
})

// ---- refresh-cookie edge cases: an undecodable cookie and a refresh that fails ----

Deno.test('iamSessionGuard: a malformed/undecodable refresh-token cookie still authenticates via an uncached refresh() — a local decode failure is never an authorization decision', async () => {
  const cache = fakeCacheProvider()
  const ctx = fakeGuardContext(cache, 'not-a-real-jwt')
  let calls = 0
  const options: IamSessionGuardOptions = {
    loginClient: fakeLoginClient(() => {
      calls++
      return Promise.resolve(refreshResult(unique('user')))
    }),
  }
  const guard = iamSessionGuard([], options)

  const result = await guard(ctx)

  assertEquals(result, {})
  assertEquals(calls, 1, 'an undecodable cookie must still reach a real refresh() call, uncached')
})

Deno.test('iamSessionGuard/iamOptionalSessionGuard: a loginClient factory is never invoked for a request with no session cookie at all', async () => {
  const cache = fakeCacheProvider()
  let factoryCalls = 0
  const options: IamSessionGuardOptions = {
    loginClient: () => {
      factoryCalls++
      return fakeLoginClient(() => Promise.resolve(refreshResult(unique('user'))))
    },
  }

  await assertRejects(async () => {
    await iamSessionGuard([], options)(fakeGuardContext(cache, undefined))
  }, HttpError)
  await iamOptionalSessionGuard(options)(fakeGuardContext(cache, undefined))

  assertEquals(
    factoryCalls,
    0,
    'a request this guard rejects/passes-through before ever needing a real client must never ' +
      "force one to be built — see IamSessionGuardOptions.loginClient's own doc for why",
  )
})

Deno.test('iamSessionGuard: a loginClient factory IS invoked, lazily, once a session cookie is actually presented', async () => {
  const cache = fakeCacheProvider()
  const subject = unique('user')
  const token = fakeJwt({ sub: subject, jti: unique('jti') })
  const ctx = fakeGuardContext(cache, token)
  let factoryCalls = 0
  const options: IamSessionGuardOptions = {
    loginClient: () => {
      factoryCalls++
      return fakeLoginClient(() => Promise.resolve(refreshResult(subject)))
    },
  }

  await iamSessionGuard([], options)(ctx)

  assertEquals(factoryCalls, 1)
})

Deno.test('seedIamSessionCache/getOrRefreshIamTokens: preferRedis reads and writes the Redis store, never the local one', async () => {
  const stores = { local: new Map<string, unknown>(), redis: new Map<string, unknown>() }
  const storeOf = (map: Map<string, unknown>) => ({
    get: (key: string) => Promise.resolve(map.get(key)),
    set: (key: string, value: unknown) => (map.set(key, value), Promise.resolve(true)),
  })
  const cache = {
    local: storeOf(stores.local),
    redis: storeOf(stores.redis),
  } as unknown as ZanixCacheProvider
  const tokens = {
    accessToken: fakeJwt({ sub: 'u-redis' }),
    refreshToken: fakeJwt({ sub: 'u-redis', jti: 'jti-redis' }),
    expiresAt: 1,
  } as RefreshResult

  await seedIamSessionCache(cache, 'u-redis', tokens, { preferRedis: true })
  assertEquals([stores.redis.size, stores.local.size], [1, 0])

  let refreshed = 0
  const served = await getOrRefreshIamTokens(
    cache,
    'u-redis',
    tokens.refreshToken,
    () => (refreshed++, Promise.resolve(tokens)),
    { preferRedis: true },
  )
  assertEquals(served, tokens)
  assertEquals(refreshed, 0)
})
