/**
 * @module
 *
 * The default stylesheet of `iam`'s views — the `./ui/styles` subpath. It styles every `data-space`
 * hook `iam`'s own markup emits (banners, the provider buttons, the one-time-code boxes, the
 * channel picker, the rate-limit card, the divider, the links and the password step) and nothing
 * else: a page or card wrapper, buttons and fields belong to the app's own design system.
 *
 * Authored as `styles.css` and imported as text (`with { type: 'text' }`), so it ships through JSR
 * as a file and reaches a `@zanix/space` app through
 * `defineSpaceApp({ cssSources: [iamCssSource] })`; `@zanix/space` places it ahead of the app's own
 * `globalCss`. An app builds it with `@zanix/cli` 2.2.8 or later: earlier versions read a `.css`
 * import as a CSS Module and hand `cssSources` an empty stylesheet. Consumers that render `iam`'s views with their own CSS, build their own UI on the
 * headless SDK, or only use the backend never import this module.
 *
 * **The app's CSS wins.** The stylesheet comes before the app's own, and its selectors are the
 * plain hook selectors a design system writes (`[data-space='x']`, or one descendant of it), so a
 * rule the app writes for the same hook with the same or more specificity overrides it, and it
 * beats the app's generic element rules (`input`, `select`, `a`), which it must. Values
 * read the design tokens the app already declares (`--space-color-*`, `--space-space-*`,
 * `--space-radius-*`) with a fallback, so an app usually restyles this by redeclaring a few tokens.
 * The tokens read are `--space-color-ink`, `-ink-muted`, `-border`, `-surface`, `-primary`,
 * `-primary-strong`, `-danger`, `-warning`, `-info` and `-success`.
 */

import iamUiCss from './styles.css' with { type: 'text' }

/** The stylesheet text. */
export const IAM_UI_CSS: string = iamUiCss

/**
 * {@linkcode IAM_UI_CSS} as a `@zanix/space` stylesheet source: pass it to
 * `defineSpaceApp({ cssSources })`. Declared here without importing that type, so this module
 * keeps no dependency on `@zanix/space`.
 */
export const iamCssSource: { readonly name: string; readonly css: string } = {
  name: 'iam',
  css: IAM_UI_CSS,
}
