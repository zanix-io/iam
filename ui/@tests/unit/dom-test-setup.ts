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

const dom = new Window()
// deno-lint-ignore no-explicit-any
const globals = globalThis as any
globals.window = dom
globals.document = dom.document
globals.navigator = dom.navigator
globals.HTMLElement = dom.HTMLElement
globals.Node = dom.Node
globals.Event = dom.Event
globals.MouseEvent = dom.MouseEvent
// Silences React's own "environment not configured for act()" warning — this file IS that
// configuration. Preact's own DOM `render()` needs no equivalent flag.
globals.IS_REACT_ACT_ENVIRONMENT = true
