import type { Formatter } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import type { OauthCallbackViewProps } from './types.ts'

/** The `useIntl` hook this view needs, injected alongside `h`. */
export type OauthCallbackViewDeps = {
  useIntl: () => Formatter
}

/**
 * The real implementation of `iam`'s OAuth2 sign-in interstitial, shared identically between the
 * React and Preact bindings (`index.ts`/`index.preact.ts`). This file never imports React, Preact,
 * or `@zanix/space-ui` itself.
 *
 * A minimal "you're signed in" interstitial — the actual session cookie is already attached to
 * THIS SAME response by the time this renders, so all this view needs to do is get the browser to
 * its next real page (`redirectTo`, `'/'` when omitted). `<meta http-equiv="refresh">` works with
 * scripting disabled, unlike a `window.location` redirect; the `<a>` is the no-JS/no-meta-refresh
 * fallback.
 *
 * `redirectTo` also carries the ONE case this interstitial does NOT mean "signed in": the owning
 * page's own `loader` passes `/${lang}/login/reactivate/:token` when `AuthService.loginWithOauthCallback`
 * returned a reactivation challenge instead of finishing login (see that page's own doc) — no
 * session cookie was attached in that case, so the heading below is misleading for that one
 * destination, but this view stays deliberately generic rather than adding a second,
 * narrowly-scoped prop for it.
 */
export function createOauthCallbackView<E>(
  h: CreateElement<E>,
  deps: OauthCallbackViewDeps,
): (props: OauthCallbackViewProps) => E {
  const { useIntl } = deps

  return function OauthCallbackView({ redirectTo = '/' }: OauthCallbackViewProps): E {
    const { formatMessage } = useIntl()
    return h(
      'main',
      null,
      h('meta', { httpEquiv: 'refresh', content: `0;url=${redirectTo}` }),
      h('h1', null, formatMessage('login/oauth/callback-heading')),
      h(
        'p',
        { 'data-space': 'auth-back-link' },
        h('a', { href: redirectTo }, formatMessage('login/oauth/callback-continue')),
      ),
    )
  }
}
