import type { IntlMessages } from '@zanix/space-ui'

/** Loader data {@linkcode createLangLayout}'s returned view expects, plus the renderer-bound
 * cookie-consent slot the OWNING route composes itself (see `render.ts`'s own doc for why this
 * view never imports the Comet directly). */
export type LangLayoutViewData<E> = {
  lang: string
  /** This request's own CSP nonce (`PageContext.cspNonce`) — threaded through to whatever the
   * owning route builds `cookieConsentSlot` from; this view itself never reads it directly. */
  cspNonce?: string
  /** This request's own resolved message catalog — merged with any host override, resolved once
   * so every page under this layout shares the same `<IntlProvider>`. */
  messages: IntlMessages
  /**
   * The already-built cookie-consent Comet element (or `null` when disabled/not yet decided-on),
   * or `undefined` when the owning host has no cookie-consent gate at all. Built by the OWNING
   * `@zanix/space` route, which is the only place that knows about the real `defineComet`-wrapped
   * module — see `render.ts`'s own doc for the full reasoning.
   */
  cookieConsentSlot?: E | null
}

/** Props {@linkcode createLangLayout}'s returned view expects — mirrors `@zanix/space`'s own
 * `LayoutProps<Children, Data>` shape, kept local rather than imported so this package's own
 * `deno.json` needs no runtime dependency on `@zanix/space` for a purely structural type. */
export type LangLayoutViewProps<Children, E> = {
  children: Children
  data: LangLayoutViewData<E>
}
