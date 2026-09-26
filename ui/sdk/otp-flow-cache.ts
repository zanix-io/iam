import type { ZanixCacheProvider } from '@zanix/server'
import type { LoginMethodsResult } from './rtos/login.ts'

/**
 * @module
 *
 * Two short-lived caches a one-time-code screen needs: which delivery channels an account can
 * receive a code on, and the resend cooldown. Both take the cache provider directly — this module
 * has no opinion on how a caller reaches one (a guard's `ctx.providers`, an `Interactor`'s own
 * `this.cache`) — and every value that differs per deployment as an option.
 */

/** How long a resolved delivery-channel lookup stays cached for one address. Long enough to cover
 * a whole code-entry-plus-resend session without spending the lookup endpoint's own rate limit. */
export const NOTIFIER_CACHE_SECONDS = 300

/** How long a resend cooldown lasts: the lower bound of the usual 30–60 s between two codes for
 * the same address. */
export const COOLDOWN_SECONDS = 30

/** The delivery channels of an account, as `iam`'s login-methods lookup reports them. */
export type NotifierMethods = Pick<LoginMethodsResult, 'otpNotifier' | 'hasVerifiedPhone'>

/** Options shared by the caches of this module. */
export type OtpFlowCacheOptions = {
  /** Store in Redis (shared across replicas) instead of this process's memory. */
  preferRedis: boolean
  /** Prefix of every cache key, so two apps sharing one cache never collide (`app-one:` gives
   * `app-one:otp-notifier-methods:<email>` and `app-one:otp-resend-cooldown:<email>`).
   * @default 'iam:' */
  keyPrefix?: string
}

/** How long the "email only" answer of a failed lookup is kept: long enough that an upstream that
 * is down or rate limited is not asked again on every reload, short enough that the other channels
 * come back as soon as it recovers. */
export const DEGRADED_CACHE_SECONDS = 30

const DEGRADED_DEFAULT: NotifierMethods = { otpNotifier: null, hasVerifiedPhone: false }

const prefixOf = (options: OtpFlowCacheOptions) => options.keyPrefix ?? 'iam:'

const notifierKey = (email: string, options: OtpFlowCacheOptions) =>
  `${prefixOf(options)}otp-notifier-methods:${email}`

/**
 * Which channel(s) are deliverable for `email`, cached so a screen reached again on every resend
 * and every reload of the same pending code never calls the lookup more than once per
 * {@linkcode NOTIFIER_CACHE_SECONDS}. Best effort: a failed lookup (a rejection, or the lookup
 * endpoint's own rate limit) resolves to email only, and that answer is kept for only
 * {@linkcode DEGRADED_CACHE_SECONDS}, so a recovered upstream is not hidden for the whole window.
 * @param fetchMethods - The real lookup, e.g. `(email) => loginClient.getLoginMethods(email)`.
 */
export async function resolveNotifierMethods(
  cache: ZanixCacheProvider,
  email: string,
  fetchMethods: (email: string) => Promise<NotifierMethods>,
  options: OtpFlowCacheOptions & { ttlSeconds?: number },
): Promise<NotifierMethods> {
  const key = notifierKey(email, options)
  const exp = options.ttlSeconds ?? NOTIFIER_CACHE_SECONDS
  const fetcher = () =>
    fetchMethods(email).then((methods): NotifierMethods => ({
      otpNotifier: methods.otpNotifier,
      hasVerifiedPhone: methods.hasVerifiedPhone,
    }))

  try {
    if (options.preferRedis) {
      return await cache.getCachedOrFetch<NotifierMethods>('redis', key, { fetcher, exp })
    }

    const cached = cache.local.get<NotifierMethods>(key)
    if (cached) return cached
    const resolved = await fetcher()
    cache.local.set(key, resolved, { exp })
    return resolved
  } catch {
    try {
      await seedNotifierMethods(cache, email, DEGRADED_DEFAULT, {
        ...options,
        ttlSeconds: DEGRADED_CACHE_SECONDS,
      })
    } catch {
      // Best effort: without it the next visit just asks again.
    }
    return DEGRADED_DEFAULT
  }
}

/**
 * Stores what a lookup already returned, so the code screen that follows does not repeat it. The
 * lookup endpoint is rate limited, and a login already spends part of that budget before this
 * screen loads. Best effort, like the lookup itself: the caller decides whether to await it.
 * @param methods - The lookup's result; only the delivery-channel fields are kept.
 */
export async function seedNotifierMethods(
  cache: ZanixCacheProvider,
  email: string,
  methods: NotifierMethods,
  options: OtpFlowCacheOptions & { ttlSeconds?: number },
): Promise<void> {
  const key = notifierKey(email, options)
  const exp = options.ttlSeconds ?? NOTIFIER_CACHE_SECONDS
  const value: NotifierMethods = {
    otpNotifier: methods.otpNotifier,
    hasVerifiedPhone: methods.hasVerifiedPhone,
  }
  if (options.preferRedis) {
    await cache.redis.set(key, value, { exp })
  }
  cache.local.set(key, value, { exp })
}

function cooldownKey(email: string, options: OtpFlowCacheOptions): string {
  return `${prefixOf(options)}otp-resend-cooldown:${email}`
}

/**
 * The absolute epoch-ms instant the current resend cooldown for `email` ends, or `undefined` when
 * none is active. Never a duration: a caller computes the remaining time against `Date.now()`
 * itself. Cooldowns are per address, never per session or IP, so two people requesting a code for
 * two different addresses never block each other.
 *
 * Reads Redis directly, never `getCachedOrFetch`: the value changes every cooldown window and a
 * read right after a fresh {@linkcode stampCooldown} must see it.
 */
export async function cooldownEndsAt(
  cache: ZanixCacheProvider,
  email: string,
  options: OtpFlowCacheOptions,
): Promise<number | undefined> {
  const key = cooldownKey(email, options)
  const value = options.preferRedis
    ? await cache.redis.get<number>(key)
    : cache.local.get<number>(key)
  return typeof value === 'number' && value > Date.now() ? value : undefined
}

/** Starts (or restarts) the cooldown for `email`, ending `seconds` from now. The entry's own TTL
 * matches that window, so a stale entry never outlives the cooldown it represents. */
export async function stampCooldown(
  cache: ZanixCacheProvider,
  email: string,
  options: OtpFlowCacheOptions & { seconds?: number },
): Promise<void> {
  const key = cooldownKey(email, options)
  const seconds = options.seconds ?? COOLDOWN_SECONDS
  const endsAt = Date.now() + seconds * 1000
  if (options.preferRedis) {
    await cache.redis.set(key, endsAt, { exp: seconds })
  } else {
    cache.local.set(key, endsAt, { exp: seconds })
  }
}

/** What {@linkcode createOtpFlowCaches} binds once for an app. */
export type OtpFlowCachesConfig = {
  /** Prefix of every cache key. @default 'iam:' */
  keyPrefix?: string
  /** Whether to store in Redis. Called on every use, so it can follow the environment. */
  preferRedis: () => boolean
  /** The delivery-channel lookup, e.g. `(email) => loginClient.getLoginMethods(email)`. */
  fetchMethods: (email: string) => Promise<NotifierMethods>
  /** @default {@linkcode NOTIFIER_CACHE_SECONDS} */
  notifierTtlSeconds?: number
  /** @default {@linkcode COOLDOWN_SECONDS} */
  cooldownSeconds?: number
}

/** The one-time-code caches of an app, with its settings bound. */
export type OtpFlowCaches = {
  /** {@linkcode resolveNotifierMethods} for `email`. */
  resolveNotifierMethods: (cache: ZanixCacheProvider, email: string) => Promise<NotifierMethods>
  /** {@linkcode seedNotifierMethods} for `email`. */
  seedNotifierMethods: (
    cache: ZanixCacheProvider,
    email: string,
    methods: NotifierMethods,
  ) => Promise<void>
  /** {@linkcode cooldownEndsAt} for `email`. */
  cooldownEndsAt: (cache: ZanixCacheProvider, email: string) => Promise<number | undefined>
  /** {@linkcode stampCooldown} for `email`. */
  stampCooldown: (cache: ZanixCacheProvider, email: string) => Promise<void>
}

/**
 * The caches of this module with an app's settings bound once, so the app declares them in one
 * place instead of re-passing them at every call site:
 *
 * ```ts
 * export const { resolveNotifierMethods, cooldownEndsAt, stampCooldown } = createOtpFlowCaches({
 *   keyPrefix: 'app-one:',
 *   preferRedis: () => Deno.env.has('REDIS_URI'),
 *   fetchMethods: (email) => getLoginClient().getLoginMethods(email),
 * })
 * ```
 */
export function createOtpFlowCaches(config: OtpFlowCachesConfig): OtpFlowCaches {
  const options = () => ({ preferRedis: config.preferRedis(), keyPrefix: config.keyPrefix })
  return {
    resolveNotifierMethods: (cache, email) =>
      resolveNotifierMethods(cache, email, config.fetchMethods, {
        ...options(),
        ttlSeconds: config.notifierTtlSeconds,
      }),
    seedNotifierMethods: (cache, email, methods) =>
      seedNotifierMethods(cache, email, methods, {
        ...options(),
        ttlSeconds: config.notifierTtlSeconds,
      }),
    cooldownEndsAt: (cache, email) => cooldownEndsAt(cache, email, options()),
    stampCooldown: (cache, email) =>
      stampCooldown(cache, email, { ...options(), seconds: config.cooldownSeconds }),
  }
}
