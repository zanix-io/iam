/** Props {@linkcode createTotpConfirmView}'s returned view expects. This page's own `static
 * redirect` always fires before `component` ever runs — see `render.ts`'s own doc for why the
 * view still exists. */
export type TotpConfirmViewProps = Record<never, never>
