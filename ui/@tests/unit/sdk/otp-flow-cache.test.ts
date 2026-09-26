import { assertEquals } from 'jsr:@std/assert@0.224'
import type { ZanixCacheProvider } from '@zanix/server'
import {
  COOLDOWN_SECONDS,
  cooldownEndsAt,
  createOtpFlowCaches,
  DEGRADED_CACHE_SECONDS,
  NOTIFIER_CACHE_SECONDS,
  resolveNotifierMethods,
  seedNotifierMethods,
  stampCooldown,
} from '../../../sdk/otp-flow-cache.ts'

type Entry = { value: unknown; exp?: number }

/** An in-memory stand-in for the two stores of a `ZanixCacheProvider` that records every write. */
function fakeCache() {
  const stores = { local: new Map<string, Entry>(), redis: new Map<string, Entry>() }
  const store = (name: 'local' | 'redis') => ({
    get: <T>(key: string) => Promise.resolve(stores[name].get(key)?.value as T | undefined),
    set: (key: string, value: unknown, options?: { exp?: number }) => {
      stores[name].set(key, { value, exp: options?.exp })
      return Promise.resolve()
    },
  })
  const cache = {
    local: {
      get: <T>(key: string) => stores.local.get(key)?.value as T | undefined,
      set: (key: string, value: unknown, options?: { exp?: number }) => {
        stores.local.set(key, { value, exp: options?.exp })
      },
    },
    redis: store('redis'),
    getCachedOrFetch: async <T>(
      _store: string,
      key: string,
      options: { fetcher: () => Promise<T>; exp: number },
    ) => {
      const hit = stores.redis.get(key)
      if (hit) return hit.value as T
      const value = await options.fetcher()
      stores.redis.set(key, { value, exp: options.exp })
      return value
    },
  } as unknown as ZanixCacheProvider
  return { cache, stores }
}

const METHODS = { otpNotifier: 'sms', hasVerifiedPhone: true } as const

Deno.test('resolveNotifierMethods: one lookup per window, in memory or in Redis', async () => {
  await Promise.all([false, true].map(async (preferRedis) => {
    const { cache } = fakeCache()
    let calls = 0
    const fetchMethods = () => {
      calls++
      return Promise.resolve({ ...METHODS, oauthProviders: [], hasPassword: true })
    }
    const options = { preferRedis }
    assertEquals(await resolveNotifierMethods(cache, 'a@x.test', fetchMethods, options), METHODS)
    assertEquals(await resolveNotifierMethods(cache, 'a@x.test', fetchMethods, options), METHODS)
    assertEquals(calls, 1, `preferRedis=${preferRedis}`)
  }))
})

Deno.test('resolveNotifierMethods: a failing lookup degrades to email only and never throws', async () => {
  const { cache } = fakeCache()
  const result = await resolveNotifierMethods(
    cache,
    'a@x.test',
    () => Promise.reject(new Error('down')),
    { preferRedis: false },
  )
  assertEquals(result, { otpNotifier: null, hasVerifiedPhone: false })
})

Deno.test('resolveNotifierMethods: a failed lookup is kept only briefly, then the next visit asks again', async () => {
  await Promise.all([false, true].map(async (preferRedis) => {
    const { cache, stores } = fakeCache()
    let calls = 0
    const fetchMethods = () => {
      calls++
      return calls === 1
        ? Promise.reject(new Error('429'))
        : Promise.resolve({ ...METHODS, oauthProviders: [], hasPassword: false })
    }
    const options = { preferRedis }
    const degraded = { otpNotifier: null, hasVerifiedPhone: false }
    const key = 'iam:otp-notifier-methods:a@x.test'

    assertEquals(await resolveNotifierMethods(cache, 'a@x.test', fetchMethods, options), degraded)
    assertEquals(stores.local.get(key)?.exp, DEGRADED_CACHE_SECONDS, `preferRedis=${preferRedis}`)
    // Not asked again while it stands: an upstream that is down is not hammered.
    assertEquals(await resolveNotifierMethods(cache, 'a@x.test', fetchMethods, options), degraded)
    assertEquals(calls, 1, `preferRedis=${preferRedis}`)

    // Once it lapses, the recovered upstream is heard.
    stores.local.delete(key)
    stores.redis.delete(key)
    assertEquals(await resolveNotifierMethods(cache, 'a@x.test', fetchMethods, options), METHODS)
    assertEquals(calls, 2, `preferRedis=${preferRedis}`)
  }))
})

Deno.test('seedNotifierMethods: a stored lookup is served without asking again, in memory or in Redis', async () => {
  await Promise.all([false, true].map(async (preferRedis) => {
    const { cache, stores } = fakeCache()
    const options = { preferRedis }
    await seedNotifierMethods(
      cache,
      'a@x.test',
      { ...METHODS, oauthProviders: [], hasPassword: false } as never,
      options,
    )
    assertEquals(stores.redis.size, preferRedis ? 1 : 0)
    assertEquals(
      await resolveNotifierMethods(
        cache,
        'a@x.test',
        () => Promise.reject(new Error('must not ask again')),
        options,
      ),
      METHODS,
    )
    assertEquals(stores.local.get('iam:otp-notifier-methods:a@x.test')?.exp, NOTIFIER_CACHE_SECONDS)
  }))
})

Deno.test('the caches are keyed by the prefix the app chose, so two apps never collide', async () => {
  const { cache, stores } = fakeCache()
  await stampCooldown(cache, 'a@x.test', { preferRedis: false, keyPrefix: 'app-one:' })
  await stampCooldown(cache, 'a@x.test', { preferRedis: false })
  assertEquals([...stores.local.keys()].sort(), [
    'app-one:otp-resend-cooldown:a@x.test',
    'iam:otp-resend-cooldown:a@x.test',
  ])
  await resolveNotifierMethods(cache, 'a@x.test', () => Promise.resolve({ ...METHODS }), {
    preferRedis: false,
    keyPrefix: 'app-one:',
  })
  assertEquals(stores.local.has('app-one:otp-notifier-methods:a@x.test'), true)
})

Deno.test('resend cooldown: active for the window, per address, then over', async () => {
  const { cache, stores } = fakeCache()
  const options = { preferRedis: false }
  assertEquals(await cooldownEndsAt(cache, 'a@x.test', options), undefined)

  const before = Date.now()
  await stampCooldown(cache, 'a@x.test', options)
  const endsAt = await cooldownEndsAt(cache, 'a@x.test', options)
  assertEquals(typeof endsAt === 'number' && endsAt >= before + COOLDOWN_SECONDS * 1000, true)
  assertEquals(await cooldownEndsAt(cache, 'b@x.test', options), undefined)
  assertEquals(stores.local.get('iam:otp-resend-cooldown:a@x.test')?.exp, COOLDOWN_SECONDS)

  stores.local.set('iam:otp-resend-cooldown:a@x.test', { value: Date.now() - 1 })
  assertEquals(await cooldownEndsAt(cache, 'a@x.test', options), undefined)
})

Deno.test('resend cooldown: reads Redis directly and honours a custom window', async () => {
  const { cache, stores } = fakeCache()
  await stampCooldown(cache, 'a@x.test', { preferRedis: true, seconds: 60 })
  assertEquals(stores.redis.get('iam:otp-resend-cooldown:a@x.test')?.exp, 60)
  assertEquals(typeof (await cooldownEndsAt(cache, 'a@x.test', { preferRedis: true })), 'number')
  assertEquals(NOTIFIER_CACHE_SECONDS > COOLDOWN_SECONDS, true)
})

Deno.test("createOtpFlowCaches: an app's settings bound once, honoured on every call", async () => {
  const { cache, stores } = fakeCache()
  let redis = false
  let lookups = 0
  const caches = createOtpFlowCaches({
    keyPrefix: 'app-one:',
    preferRedis: () => redis, // follows the environment on every use
    fetchMethods: () => {
      lookups++
      return Promise.resolve({ ...METHODS })
    },
    cooldownSeconds: 45,
  })

  assertEquals(await caches.resolveNotifierMethods(cache, 'a@x.test'), METHODS)
  assertEquals(stores.local.has('app-one:otp-notifier-methods:a@x.test'), true)

  await caches.stampCooldown(cache, 'a@x.test')
  assertEquals(stores.local.get('app-one:otp-resend-cooldown:a@x.test')?.exp, 45)
  assertEquals(typeof (await caches.cooldownEndsAt(cache, 'a@x.test')), 'number')

  redis = true // the same bound functions now use Redis
  await caches.stampCooldown(cache, 'b@x.test')
  assertEquals(stores.redis.has('app-one:otp-resend-cooldown:b@x.test'), true)
  assertEquals(lookups, 1)
})

Deno.test('createOtpFlowCaches: seedNotifierMethods stores under the bound prefix with the bound TTL', async () => {
  const { cache, stores } = fakeCache()
  const caches = createOtpFlowCaches({
    keyPrefix: 'app-two:',
    preferRedis: () => false,
    fetchMethods: () => Promise.reject(new Error('never called')),
    notifierTtlSeconds: 90,
  })
  await caches.seedNotifierMethods(cache, 'c@x.test', { ...METHODS })
  assertEquals(stores.local.get('app-two:otp-notifier-methods:c@x.test'), {
    value: METHODS,
    exp: 90,
  })
  assertEquals(await caches.resolveNotifierMethods(cache, 'c@x.test'), METHODS)
})

Deno.test('resolveNotifierMethods: when both the lookup and storing the fallback fail, still returns email only', async () => {
  const { cache } = fakeCache()
  const broken = {
    ...cache,
    local: {
      get: () => undefined,
      set: () => {
        throw new Error('cache unavailable')
      },
    },
  } as unknown as ZanixCacheProvider
  const methods = await resolveNotifierMethods(
    broken,
    'd@x.test',
    () => Promise.reject(new Error('lookup failed')),
    { preferRedis: false },
  )
  assertEquals(methods, { otpNotifier: null, hasVerifiedPhone: false })
})
