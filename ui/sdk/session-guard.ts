/**
 * @module
 *
 * Real, hardened session guards for any `@zanix/space` app that DELEGATES its login/2FA/recovery
 * flow to a real, separately-deployed `iam` instance — `docs/consuming-iam.md`'s Tier 2 (Direct
 * page/component import) and Tier 3 (Headless SDK) consumers, never Tier 1 (Hosted redirect, which
 * has no guard of its own to write — the redirect IS the auth boundary).
 *
 * `@zanix/auth`'s own `pageSessionGuard`/`optionalSessionGuard` are the wrong tool for this shape
 * of consumer: both are pure composition over `deriveSessionToken`, which verifies and ROTATES a
 * session TOKEN PAIR LOCALLY, against a copy of the same signing key `iam` itself holds — correct
 * for an app that genuinely IS its own session issuer (`iam` itself, `@zanix/console`), wrong for
 * one that already delegates that decision to a real `iam` deployment over its REST API. Calling
 * `iam`'s real `POST /login/refresh` on every request re-verifies the linked account is still
 * active and re-resolves the caller's CURRENT role on every call — a guarantee a local rotation
 * structurally cannot offer (there is no database to re-check against). `docs/ARCHITECTURE.md`'s
 * own governing decision for this ecosystem is "never re-verify a session locally" for exactly this
 * reason — see `requireSession`'s own doc in any real Tier 2/3 consumer for the fuller reasoning
 * this module generalizes away from having to hand-roll again.
 *
 * Extracted from `@presenza/web`'s own `require-session.ts`/`resolve-optional-session.ts`/
 * `session-refresh-cache.ts` (12 sep 2026) after that consumer's own migration attempt to
 * `@zanix/auth`'s native guards surfaced this exact architectural mismatch — the real motivation
 * for a THIRD guard shape, owned by `iam` itself (the one party positioned to know its own real
 * rate-limit/rotation contract) rather than `@zanix/auth` (which has no opinion on any specific
 * external issuer) or left for every Tier 2/3 consumer to keep re-inventing.
 */

import type {
  GuardContext,
  GuardResponse,
  MiddlewareGlobalGuard,
  ScopedContext,
  ZanixCacheProvider,
} from '@zanix/server'
import { RestClientError, SESSION_HEADERS } from '@zanix/server'
import {
  applySessionTokens,
  attachRotatedSessionToError,
  decodeJWT,
  permissionsPipe,
} from '@zanix/auth'
import { HttpError } from '@zanix/errors'
import type { LoginClient } from './client/login.client.ts'
import type { RefreshResult } from './rtos/login.ts'

/** Options shared by {@link iamSessionGuard} and {@link iamOptionalSessionGuard}. */
export interface IamSessionGuardOptions {
  /** The real client to call `refresh()` on, OR a factory that builds one — resolved lazily, only
   * once a request actually presents a refresh-token cookie worth calling `refresh()` for, never
   * eagerly at guard-construction time (a request this guard rejects before ever needing a real
   * client — no cookie at all — must never require one configured). Pass a plain `LoginClient` when
   * building it is cheap and side-effect-free (the common case: `new LoginClient({ baseUrl })`
   * reads no env var of its own); pass a factory (`() => LoginClient`) when construction itself can
   * throw or has a cost worth deferring — e.g. one that reads a required env var for its base URL
   * and should only do so for a request that actually needs it. Either way, nothing here reuses a
   * single instance across requests on your behalf — pass an already-built singleton directly if
   * that's what you want reused. */
  loginClient: LoginClient | (() => LoginClient)
  /** How long a refreshed token pair stays cached before calling `iam`'s real `POST /login/refresh`
   * again for the same `(subject, refresh-token-id)` pair. Deliberately conservative relative to
   * `iam`'s own real access-token lifetime (its default is around an hour) rather than reading the
   * exact `expiresAt` value back from a real refresh call — a fixed, short window never risks
   * serving a token past its own real expiry, and stays comfortably inside `iam`'s own per-subject
   * `criticRateLimit` (`docs/consuming-iam.md`'s "Rate limiting" section) for a normal multi-page
   * browsing session. Defaults to 5 minutes. */
  cacheTtlSeconds?: number
  /** Cache the refreshed pair across replicas via a real `cache:redis` core connector instead of
   * the default per-process-only cache. Pass `true` only when your own app actually registered one
   * (`ctx.providers.get('cache')`'s own `.redis`) — this module never reads any env var itself to
   * decide; that choice (and its name) stays entirely yours. Defaults to `false` — an in-process-
   * only cache still closes the same-replica race this cache exists for (see this module's own
   * `getOrRefreshIamTokens` doc), just not across replicas. */
  preferRedis?: boolean
}

const DEFAULT_CACHE_TTL_SECONDS = 5 * 60

function cacheKey(subject: string, tokenId: string): string {
  return `iam-session-guard:${subject}:${tokenId}`
}

/** The refresh token's own `jti` claim — purely a cache-key, never an authorization decision
 * (`refresh()` itself is what actually authenticates the caller). `undefined` for anything
 * undecodable. */
function tokenId(refreshToken: string): string | undefined {
  try {
    return decodeJWT(refreshToken).payload.jti as string | undefined
  } catch {
    return undefined
  }
}

function store(cache: ZanixCacheProvider, preferRedis: boolean | undefined) {
  return preferRedis ? cache.redis : cache.local
}

function writeCachedTokens(
  cache: ZanixCacheProvider,
  preferRedis: boolean | undefined,
  key: string,
  tokens: RefreshResult,
  ttlSeconds: number,
): Promise<unknown> {
  return Promise.resolve(store(cache, preferRedis).set(key, tokens, { exp: ttlSeconds }))
}

/**
 * Seeds the cache with a token pair `iam` just issued directly from a real login/OTP/TOTP
 * completion — without this, the FIRST guarded page view right after a successful sign-in is
 * always a cache MISS for {@link getOrRefreshIamTokens} (nothing is cached yet for a refresh token
 * this young), forcing an immediate, unneeded real `POST /login/refresh` call for a token that's
 * still perfectly valid — and if THAT call lands inside `iam`'s own `criticRateLimit` per-subject
 * window (a real, reproduced case: two tabs, a near-simultaneous double refresh sharing the same
 * subject's one-request budget), the caller is bounced back to the login page moments after a
 * genuinely successful sign-in. Call this right after applying a fresh login/OTP/TOTP result onto
 * your own session (`applySessionTokens`), with the SAME `result`.
 *
 * Takes the cache provider directly rather than reading it off a `ctx` — this module has no
 * opinion on HOW you reach a real `ZanixCacheProvider` (a guard's own `ctx.providers`, an
 * `Interactor`'s own `this.cache`, ...), only that you get one. Load-bearing for a login page's own
 * `action`, which (unlike a guard's `GuardContext`) has no `providers` of its own to read one from
 * at all.
 */
export async function seedIamSessionCache(
  cache: ZanixCacheProvider,
  subject: string,
  tokens: RefreshResult,
  options: Pick<IamSessionGuardOptions, 'cacheTtlSeconds' | 'preferRedis'> = {},
): Promise<void> {
  const id = tokenId(tokens.refreshToken)
  if (!id) return
  const ttl = options.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS
  await writeCachedTokens(cache, options.preferRedis, cacheKey(subject, id), tokens, ttl)
}

const inFlightRefreshes = new Map<string, Promise<RefreshResult>>()

/**
 * Returns the presented refresh token's already-cached pair when one is still fresh enough, or
 * calls `refresh()` and caches its result — the real fix for a guard otherwise calling `iam`'s real
 * `POST /login/refresh` on every single guarded page view, which exhausts `criticRateLimit` for
 * real, legitimate traffic almost immediately (`docs/consuming-iam.md`'s "Rate limiting" section).
 *
 * **Keyed by `(subject, tokenId)`, never `subject` alone** — the SAME real user can hold TWO
 * genuinely independent sessions at once (two tabs, two devices), each with its own legitimately
 * issued refresh token; sharing one cache slot per subject would silently hand whichever session's
 * token got cached first to every OTHER session for that subject too.
 *
 * De-dups concurrent callers presenting the SAME `(subject, tokenId)` pair in-process — without it,
 * two requests landing within the same instant (an Orbit prefetch racing the real navigation, an
 * SSR render racing a client-side fetch) both see a cache MISS on the identical, still-valid,
 * not-yet-rotated token before either write lands, and BOTH call `iam`'s real refresh endpoint —
 * the second one squarely inside `criticRateLimit`'s window, failing with a real `429` even though
 * the first call's result was already on its way to this very cache. Only closes the same-replica
 * case; a genuinely independent second guarded request (or a second replica without
 * `options.preferRedis`) still relies on the caller's own `429` handling (see
 * {@link iamSessionGuard}'s own doc).
 */
export async function getOrRefreshIamTokens(
  cache: ZanixCacheProvider,
  subject: string,
  presentedRefreshToken: string,
  refresh: () => Promise<RefreshResult>,
  options: Pick<IamSessionGuardOptions, 'cacheTtlSeconds' | 'preferRedis'> = {},
): Promise<RefreshResult> {
  const presentedId = tokenId(presentedRefreshToken)
  // Undecodable — nothing safe to key a cache entry on; falls straight through to a real,
  // uncached `refresh()` call, which gets the same "expired, invalid, or revoked" rejection it
  // always did.
  if (!presentedId) return refresh()

  const ttl = options.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS
  const key = cacheKey(subject, presentedId)

  const cached = await store(cache, options.preferRedis).get<RefreshResult>(key)
  if (cached !== undefined) return cached

  const inFlight = inFlightRefreshes.get(key)
  if (inFlight) return inFlight

  const promise = (async () => {
    try {
      const fresh = await refresh()

      const write = (writeKey: string) =>
        writeCachedTokens(cache, options.preferRedis, writeKey, fresh, ttl)

      const writes = [write(key)]
      const rotatedId = tokenId(fresh.refreshToken)
      // Only a genuine rotation needs the second write — an identical id (a caller that doesn't
      // actually rotate) would just repeat the same write for no reason.
      if (rotatedId && rotatedId !== presentedId) writes.push(write(cacheKey(subject, rotatedId)))

      await Promise.all(writes)
      return fresh
    } finally {
      inFlightRefreshes.delete(key)
    }
  })()

  inFlightRefreshes.set(key, promise)
  return promise
}

function readRefreshCookie(ctx: ScopedContext): string | undefined {
  const refreshTokenCookie = SESSION_HEADERS.user.token as string
  return ctx.cookies?.[refreshTokenCookie]
}

function resolveIamTokens(
  ctx: GuardContext,
  refreshToken: string,
  options: IamSessionGuardOptions,
): Promise<RefreshResult> {
  // Never lets a LOCAL decode failure become an authorization decision — only the real upstream
  // `refresh()` call is. A malformed/undecodable cookie (not a JWT at all, a differently-shaped
  // but still potentially valid token, ...) falls straight through to an uncached `refresh()`
  // call instead of rejecting here, the same tolerance `readRefreshCookie`'s own caller gives an
  // absent cookie a chance to authenticate for real rather than pre-judging it.
  let subject: string | undefined
  try {
    subject = decodeJWT(refreshToken).payload.sub as string | undefined
  } catch {
    subject = undefined
  }

  const loginClient = typeof options.loginClient === 'function'
    ? options.loginClient()
    : options.loginClient
  const refresh = () => loginClient.refresh(refreshToken)

  return subject
    ? getOrRefreshIamTokens(
      ctx.providers.get('cache'),
      subject,
      refreshToken,
      refresh,
      options,
    )
    : refresh()
}

/**
 * Validates the caller's own session on every visit to a protected page against a real,
 * separately-deployed `iam` instance — the delegated-issuer counterpart to `@zanix/auth`'s own
 * `pageSessionGuard`. Missing/invalid/expired cookie, or a rejected refresh: throws
 * `HttpError('UNAUTHORIZED')`, same contract `pageSessionGuard` gives a consuming app's own
 * unauthenticated-visit handling.
 *
 * A `429` from `iam`'s real `refresh` call is NOT evidence the presented refresh token is invalid —
 * it only means this subject's rate-limit budget was already spent, most commonly by a
 * near-simultaneous duplicate request that {@link getOrRefreshIamTokens}'s own single-flight de-dup
 * can't catch (a genuinely independent second guarded request, a second replica without
 * `options.preferRedis`). Collapsing that into `UNAUTHORIZED` would silently discard an otherwise-
 * still-valid session and force a full re-login over a transient, self-correcting condition — this
 * re-throws the original `RestClientError` unchanged instead, so a caller's own error handling can
 * tell a real `429` apart from a genuine session rejection and leave existing cookies alone rather
 * than misreport a still-valid session as logged out.
 *
 * Rebuilds the response cookie for a session token pair `iam` rotated server-side even when a LATER
 * check (the `permissions` pipe below) rejects the request — without this, a permission failure
 * right after a genuinely successful refresh would silently drop the just-rotated cookie, stranding
 * the caller on a token `iam` already superseded. See `@zanix/auth`'s own
 * `attachRotatedSessionToError`/`recoverRotatedSessionCookie` for the mechanism this relies on —
 * your app needs `recoverRotatedSessionCookie` wired into its own error response path (the same
 * `pageSessionGuard` consumers already need) for this guarantee to actually reach the browser.
 */
export function iamSessionGuard(
  permissions: string[],
  options: IamSessionGuardOptions,
): MiddlewareGlobalGuard {
  const requirePermissions = permissionsPipe(permissions)

  return async (ctx): Promise<GuardResponse> => {
    const scopedCtx = ctx as unknown as ScopedContext
    const refreshToken = readRefreshCookie(scopedCtx)

    if (!refreshToken) {
      throw new HttpError('UNAUTHORIZED', { message: 'No session cookie present.' })
    }

    let tokens: RefreshResult
    try {
      tokens = await resolveIamTokens(ctx, refreshToken, options)
    } catch (error) {
      if (error instanceof RestClientError && error.realHttpStatus === 429) {
        throw error
      }
      throw new HttpError('UNAUTHORIZED', {
        message: 'Session refresh failed — the refresh token is expired, invalid, or revoked.',
        cause: error,
      })
    }

    applySessionTokens(scopedCtx, tokens)
    Object.assign(scopedCtx.locals.session as object, { accessToken: tokens.accessToken })

    try {
      await requirePermissions(ctx)
    } catch (error) {
      throw attachRotatedSessionToError(error, scopedCtx)
    }
    return {}
  }
}

/**
 * Resolves a REAL session onto `ctx.locals.session` against a real, separately-deployed `iam`
 * instance when one exists, but never gates the request on it — the delegated-issuer counterpart to
 * `@zanix/auth`'s own `optionalSessionGuard`. The right tool for a page that must stay reachable by
 * an anonymous visitor while still rendering differently for one who happens to be logged in (a
 * public landing page with its own "your dashboard" section, say).
 *
 * Every failure path — no cookie, a malformed one, a rejected refresh, even a `429` rate-limit —
 * resolves to "no session" rather than throwing. Safe to fail open on: the worst case is a
 * genuinely logged-in visitor whose refresh call happened to fail on this one request sees the
 * anonymous view instead of their own session for that single page view — never an authorization
 * bypass, since nothing downstream ever receives an `accessToken` unless a real `iam` refresh call
 * actually succeeded.
 *
 * **Known, accepted narrower guarantee than {@link iamSessionGuard}**: on a failed refresh call,
 * this never attempts `attachRotatedSessionToError`'s recovery for the rare case where `iam`
 * rotated the token pair server-side before the same call failed downstream (a `429` after
 * rotation, say) — that recovery is built around a THROWN error reaching your app's own error
 * handler, which this guard, by design, never produces. Acceptable specifically because the
 * failure mode here stays "renders the anonymous view instead of the real one for this one visit",
 * never a stranded, unusable session the way it would be for a page {@link iamSessionGuard} actually
 * gates.
 */
export function iamOptionalSessionGuard(
  options: IamSessionGuardOptions,
): MiddlewareGlobalGuard {
  return async (ctx): Promise<GuardResponse> => {
    const scopedCtx = ctx as unknown as ScopedContext
    const refreshToken = readRefreshCookie(scopedCtx)
    if (!refreshToken) return {}

    try {
      const tokens = await resolveIamTokens(ctx, refreshToken, options)
      applySessionTokens(scopedCtx, tokens)
      Object.assign(scopedCtx.locals.session as object, { accessToken: tokens.accessToken })
    } catch {
      // Any failure (expired/invalid/revoked token, a `429` rate-limit, `iam` unreachable)
      // resolves to "no session" — see this function's own doc for why that's correct here, and
      // the one known gap it accepts relative to `iamSessionGuard`.
    }
    return {}
  }
}
