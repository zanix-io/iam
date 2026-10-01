// deno-coverage-ignore-file

/**
 * Shared real-DOM bootstrap for a component whose contract can't be verified from static SSR
 * markup alone (`renderToStaticMarkup`/`preact-render-to-string` never dispatch a real click
 * event) — `CookieConsentModal`'s own Accept/Decline handlers are the first case in this package.
 * Mirrors `@zanix/space-ui`'s own `dom-test-setup.ts` exactly, down to the same `happy-dom`
 * choice (zero transitive dependencies, unlike `jsdom`). Side-effecting on import: importing this
 * module once installs a single `happy-dom` document/window for the whole `deno test` process (ES
 * modules are evaluated once and cached, so every test file importing this shares one instance).
 */
import { Window } from 'happy-dom'

// A real origin (not `about:blank`, happy-dom's own default with no `url` given) is required for
// `history.replaceState`/`pushState` to accept a relative URL at all — `RateLimitCountdown`'s own
// `onComplete` calls it with one, so this shared harness needs a real base URL for that Comet's
// own test to exercise the actual browser contract rather than a same-origin restriction no real
// page load would ever trigger.
const dom = new Window({ url: 'http://localhost/' })
// deno-lint-ignore no-explicit-any
const globals = globalThis as any
globals.window = dom
globals.document = dom.document
globals.navigator = dom.navigator
globals.HTMLElement = dom.HTMLElement
globals.HTMLFormElement = dom.HTMLFormElement
globals.Node = dom.Node
globals.Event = dom.Event
globals.MouseEvent = dom.MouseEvent
// `RateLimitCountdown`'s own `onComplete` reads/rewrites the address bar directly
// (`globalThis.location`/`globalThis.history.replaceState`) — real browser globals happy-dom's
// `Window` already implements, just not bridged onto `globalThis` until a component actually
// needed them.
globals.location = dom.location
globals.history = dom.history
// `otp-code-field`'s own real auto-submit mechanism schedules through the real
// `requestAnimationFrame` — happy-dom's `Window` ships a real implementation of it, just never
// bridged onto `globalThis` until a component actually needed one.
globals.requestAnimationFrame = dom.requestAnimationFrame.bind(dom)
globals.cancelAnimationFrame = dom.cancelAnimationFrame.bind(dom)
// Silences React's own "environment not configured for act()" warning — this file IS that
// configuration. Preact's own DOM `render()` needs no equivalent flag.
globals.IS_REACT_ACT_ENVIRONMENT = true

/** Same helper `@zanix/space-ui`'s own `dom-test-setup.ts` ships — asserts a `querySelector`
 * result is non-null without a lint-flagged `!` non-null assertion at every call site. */
export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('Expected a non-null value, got ' + String(value))
  }
  return value
}
