/**
 * Test-only helpers to exercise the REAL guards a controller/page registered through its own
 * decorators, instead of re-building a guard with a literal copy of the options the source file
 * happens to pass (a copy never fails when the decorator itself changes).
 *
 * REST controllers are read through `@zanix/server`'s public `ProgramModule.routes.getRoutes()`;
 * its published `RestRouteEntry` type omits the `guards`/`handler` fields the registry stores at
 * runtime, hence the widening cast in {@link restRoutes}.
 * Space pages register their routes only at app bootstrap, so their class-level guards are read
 * from the class's own `@Guard` metadata key instead — {@link readClassGuards} throws when that
 * key is missing, so a change to the metadata format fails loudly rather than letting a guard
 * assertion pass vacuously against an empty list.
 */
import { ProgramModule } from '@zanix/server'
import type { GuardContext } from '@zanix/server'
import { jwtValidationGuard, rateLimitGuard } from '@zanix/auth'
import { refreshRateLimitIdentityGuard } from 'utils/refresh-rate-limit-guard.ts'
import { phoneConfirmRateLimitIdentityGuard } from 'utils/phone-confirm-rate-limit-guard.ts'

// deno-lint-ignore no-explicit-any
export type AnyGuard = (ctx: any) => unknown

export type RegisteredRoute = {
  path: string
  httpMethod: string
  guards: AnyGuard[]
  handler: { propertyKey: string }
  rto?: Record<string, { name: string }>
}

/** Every REST route registered so far in this process (one test file = one isolate), keyed by
 * `"<METHOD> <path>"`. */
export function restRoutes(): Record<string, RegisteredRoute> {
  const routes = (ProgramModule.routes.getRoutes('rest') ?? {}) as unknown as Record<
    string,
    RegisteredRoute
  >
  return Object.fromEntries(
    Object.values(routes).map((route) => [`${route.httpMethod} ${route.path}`, route]),
  )
}

/** Class-level (`@Guard` on the class) guards of a decorated page/controller class. */
export function readClassGuards(Target: object): AnyGuard[] {
  const guards = (Target as Record<string, unknown>)['data:MiddlewaresContainer:guards:local']
  if (!Array.isArray(guards)) {
    throw new Error(
      `[test] no class-level guard metadata found on ${(Target as { name?: string }).name}`,
    )
  }
  return guards as AnyGuard[]
}

const SOURCE = {
  rateLimit: rateLimitGuard({ app: 'x', anonymousLimit: 1, trustProxyHeader: true }).toString(),
  jwt: jwtValidationGuard({}).toString(),
  refreshIdentity: refreshRateLimitIdentityGuard().toString(),
  phoneIdentity: phoneConfirmRateLimitIdentityGuard().toString(),
}

export type GuardKind = keyof typeof SOURCE | 'other'

/** Identifies a registered guard by the factory that produced it — every call to the same factory
 * returns a closure with the same source text, whatever options it was given. */
export function guardKind(guard: AnyGuard): GuardKind {
  const source = guard.toString()
  for (const [kind, known] of Object.entries(SOURCE)) {
    if (source === known) return kind as GuardKind
  }
  return 'other'
}

/** An in-memory stand-in for the `cache` provider `rateLimitGuard` reads through
 * `ctx.providers.get('cache')` (local branch only — `REDIS_URI` must stay unset). Records every
 * key it's asked for, so a test can assert which bucket a request landed in. */
export function fakeRateLimitCache() {
  const store = new Map<string, unknown>()
  const keys: string[] = []
  return {
    keys,
    store,
    withLock: (key: string, run: () => unknown) => {
      keys.push(key)
      return run()
    },
    local: {
      get: (key: string) => store.get(key),
      set: (key: string, value: unknown) => void store.set(key, value),
      delete: (key: string) => void store.delete(key),
    },
  }
}

/** A minimal guard context: an anonymous caller from `ip` (behind a trusted proxy), sharing
 * `cache` across calls so repeated requests accumulate in the same buckets. */
export function guardContext(
  cache: ReturnType<typeof fakeRateLimitCache>,
  options: {
    ip?: string
    headers?: Record<string, string>
    cookies?: Record<string, string>
    session?: Record<string, unknown>
  } = {},
): GuardContext {
  return {
    id: 'ctx-test',
    req: {
      headers: new Headers({ 'x-forwarded-for': options.ip ?? '203.0.113.7', ...options.headers }),
    },
    cookies: options.cookies ?? {},
    locals: options.session ? { session: { ...options.session } } : {},
    providers: {
      get: (key: string) => {
        if (key === 'cache') return cache
        throw new Error(`[test] Unmocked provider requested: ${key}`)
      },
    },
  } as unknown as GuardContext
}

/** Runs `guards` in order, stopping at the first one that returns a `response` (the same
 * short-circuit the server applies). Returns that response's status, or `undefined` when every
 * guard let the request through. */
export async function runGuards(
  guards: AnyGuard[],
  ctx: GuardContext,
): Promise<number | undefined> {
  for (const guard of guards) {
    // Sequential by design: each guard sees what the previous one wrote into `ctx.locals`.
    // deno-lint-ignore no-await-in-loop
    const result = await guard(ctx) as { response?: Response } | undefined
    if (result?.response) return result.response.status
  }
  return undefined
}

/** How many consecutive requests `guards` allow from one fresh context factory before the first
 * `429`, capped at `max` attempts. */
export async function allowedBeforeLimit(
  guards: AnyGuard[],
  makeContext: () => GuardContext,
  max = 20,
): Promise<number> {
  for (let attempt = 0; attempt < max; attempt++) {
    // Sequential by design: each attempt must observe the counter the previous one incremented.
    // deno-lint-ignore no-await-in-loop
    const status = await runGuards(guards, makeContext())
    if (status === 429) return attempt
  }
  return max
}
