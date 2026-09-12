/**
 * The signature shared by React's `createElement` and Preact's `h` — both accept a host element
 * tag OR a component reference, a props object (or `null`), and any number of children, and
 * return their own renderer's element type. Every shared `render.ts` factory in this package is
 * typed against ONLY this shape — never against `React.createElement`'s or `h`'s own concrete,
 * more specific signature — so the same factory function binds to either renderer with no React
 * or Preact import of its own. Mirrors `@zanix/space-ui`'s own `typings/renderer.ts`, widened here
 * to accept a component reference as `type` too.
 *
 * **Always pass an injected `@zanix/space-ui`/Comet dependency through `h`/`createElement` this
 * way — never call it directly as a bare function.** A component built from ANOTHER real
 * component (`Field`, `Input`, `Modal`, `IntlProvider`, `ManagedForm`, `SubmitGuard`, ...) may call
 * real hooks internally; invoking it as a plain function outside an actual render pass either
 * throws "Invalid hook call" (no active dispatcher at all) or, worse, silently attaches its hooks
 * to the CALLING component's own hook slots instead (an active dispatcher exists, but for the
 * wrong component) — confirmed via a real repro on `@zanix/space-ui`'s own `Field`/`Input`/`Modal`
 * (`useId`/`useState`/`useContext`+more, respectively). `Button`/`Link` happen to have no hooks of
 * their own today, but there is no future-proof way to tell from a component's own public type
 * alone — `h(Component, props, ...children)` is correct and safe regardless, so it's the only
 * pattern this package uses for composing an already-bound dependency.
 */
export type CreateElement<E = unknown> = (
  type: string | ((props: never) => E | null),
  props: Record<string, unknown> | null,
  ...children: unknown[]
) => E
