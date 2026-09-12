/** Props {@linkcode createOauthCallbackView}'s returned view expects — this view reads no `loader`
 * data of its own (the actual token exchange runs in the owning page's `loader`, discarding its
 * result — see that page's own doc for why). */
export type OauthCallbackViewProps = Record<never, never>
