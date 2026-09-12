/** Props {@linkcode createConsentView}'s returned view expects. This page has no real `loader`
 * data of its own beyond the route's dynamic segments — kept as an explicit (structurally empty)
 * type rather than `void`/`undefined` so a future field has a natural place to land.
 * `Record<never, never>` (not `Record<string, never>`) deliberately produces no index signature —
 * an index signature here would reject the `key` prop React/Preact both inject when this view is
 * rendered as a list item or via `h(ConsentView, {})`. */
export type ConsentViewProps = Record<never, never>
