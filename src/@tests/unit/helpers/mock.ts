/**
 * Shared test-only helpers to unit-test `ZanixInteractor`/`ZanixController`/`ZanixProvider`
 * subclasses in isolation.
 *
 * `providers`/`connectors`/`context` (interactors) and `interactor` (handlers) are plain getters
 * on the framework's base classes (see `@zanix/server`'s `CoreBaseClass`/`ContextualBaseClass`/
 * `HandlerBaseClass`). Defining an own property with the same name on a concrete instance shadows
 * the inherited accessor for every read, so a test can swap in a lightweight fake without
 * touching the real DI container/`ProgramModule` at all. Same pattern `zanix-server-conventions`
 * documents for controllers, applied here to interactors/providers too.
 */

// deno-lint-ignore no-explicit-any
type Key = any

/** Builds a `{ get }` accessor (matching `ZanixProvidersGetter`/`ZanixInteractorsGetter`'s shape)
 * backed by a `Map` keyed by class reference or string slot name. Throws loudly if a test forgets
 * to mock something the code under test actually requests — better than a silent `undefined`. */
export function mapGetter(entries: [Key, unknown][]) {
  const map = new Map<Key, unknown>(entries)
  return {
    get(key: Key) {
      if (!map.has(key)) {
        const name = typeof key === 'function' ? key.name : String(key)
        throw new Error(`[test] Unmocked target requested: ${name}`)
      }
      return map.get(key)
    },
  }
}

/** Shadows an own accessor (`providers`, `connectors`, `context`, `interactor`, etc.) on a given
 * instance with a fixed value, bypassing the real framework getter entirely. */
// deno-lint-ignore no-explicit-any
export function mockAccessor(instance: any, prop: string, value: unknown) {
  Object.defineProperty(instance, prop, { value, configurable: true, enumerable: true })
}

/** Minimal manual call-recorder, used instead of a `@std/testing` spy to avoid an extra pinned
 * dependency version — wraps `impl` and exposes every call's arguments via `.calls`. */
// deno-lint-ignore no-explicit-any
export function fn<T extends (...args: any[]) => any>(impl: T): T & { calls: Parameters<T>[] } {
  const calls: Parameters<T>[] = []
  const wrapped = ((...args: Parameters<T>) => {
    calls.push(args)
    return impl(...args)
  }) as T & { calls: Parameters<T>[] }
  wrapped.calls = calls
  return wrapped
}
