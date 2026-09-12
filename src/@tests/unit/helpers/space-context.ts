import type { ComponentType } from 'react'
import type { PageActionContext, PageContext } from '@zanix/space'
// Side-effect only — a REAL render pass (needed by `renderComponentWithIntl` below) actually
// invokes any Comet a component renders (`ManagedForm`/`SubmitGuard`), which needs the active
// renderer's element factory registered — the same import `space.app.ts` does at its own top for
// the exact same reason. Importing it once here, in this shared helper module, covers every test
// file that imports `renderComponentWithIntl` — no need to repeat it per file.
import '@zanix/space/react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { IntlProvider } from '@zanix/space-ui'
import type { IntlMessages } from '@zanix/space-ui'
import { mockPageContext } from '@zanix/space/testing'

/**
 * `@zanix/space/testing` ships `mockPageContext` (for `loader`) but no `action`-shaped equivalent
 * yet (confirmed against its real `mod.ts` exports) — this project's own small extension, built
 * from `mockPageContext` itself rather than duplicating its defaults, for testing a page's own
 * `action` in isolation.
 *
 * @param overrides - Same shape `mockPageContext` accepts, plus `body` (the page's own already-
 * validated RTO instance, what a real `PageActionContext.body` carries).
 */
export function mockActionContext<Params = Record<string, string>, Body = unknown>(
  overrides: Partial<PageContext<Params>> & { body?: Body } = {},
): PageActionContext<Params, Body> {
  const { body, ...pageOverrides } = overrides
  return {
    ...mockPageContext<Params>(pageOverrides),
    formData: () => Promise.resolve(new FormData()),
    body,
    locals: {},
  }
}

/**
 * Renders `Component` for real, through `react-dom/server`, wrapped in the SAME `<IntlProvider>`
 * `[lang]/layout.tsx` provides in production. Needed the moment a page's own component calls
 * `useIntl()` — a real hook, invalid to call outside an actual render pass: `Component(props)`
 * called directly (the pattern every OTHER `page.component({...})` unit test still uses for pages
 * that don't call `useIntl()`) throws "Invalid hook call" the instant it does.
 *
 * `createElement(Component, props)` — NOT `Component(props)` passed as a child. The latter would
 * invoke `Component` immediately, as a plain function, before React's own render pass ever starts,
 * hitting the exact same "Invalid hook call" trap `useIntl()` exists to avoid; `createElement`
 * only DESCRIBES the call, letting React itself invoke `Component` at the correct point, with a
 * real dispatcher (and this provider's context) in scope.
 *
 * @param Component - A page's own `component` field (e.g. `page.component`), or any component
 * calling `useIntl()`.
 * @param props - Whatever `Component` expects as its own view props.
 * @param messages - Catalog to format against — pass only the keys the test actually asserts on,
 * mirroring `en/index.json`'s own real values so the rendered markup reads like the real page.
 * @param locale - Defaults to `'en'`, matching every other test in this project.
 */
export function renderComponentWithIntl<P>(
  Component: ComponentType<P>,
  props: P,
  messages: IntlMessages = {},
  locale = 'en',
): string {
  // `as ComponentType<object>` — `createElement`'s own overload set can't resolve a generic `P`
  // here (confirmed: every overload fails inference the same way), the same reason
  // `renderPageForTest`'s own `TComponent` stays intentionally uninferred elsewhere in this
  // ecosystem's testing helpers. Callers still get a real, checked `P` on `props` above; only this
  // internal `createElement` call needs the widened type.
  const element = createElement(Component as ComponentType<object>, props as object)
  return renderToStaticMarkup(createElement(IntlProvider, { locale, messages }, element))
}
