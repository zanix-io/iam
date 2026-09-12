/** Props {@linkcode createOauthCallbackErrorView}'s returned view expects — mirrors the fields of
 * `@zanix/space`'s own `ErrorBoundaryProps` this view actually reads, kept local so this package
 * carries no runtime dependency on `@zanix/space` for a purely structural type. */
export type OauthCallbackErrorViewProps = {
  /** The failed route's own dynamic segments — only `lang` is read here. */
  params: unknown
  /** Retries the current page (a real re-fetch/swap), never a local re-render of just this
   * boundary's own children. */
  reset: () => void
}
