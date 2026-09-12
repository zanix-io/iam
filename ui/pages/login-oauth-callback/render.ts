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
 * its next real page. `<meta http-equiv="refresh">` works with scripting disabled, unlike a
 * `window.location` redirect; the `<a>` is the no-JS/no-meta-refresh fallback.
 */
export function createOauthCallbackView<E>(
  h: CreateElement<E>,
  deps: OauthCallbackViewDeps,
): (props: OauthCallbackViewProps) => E {
  const { useIntl } = deps

  return function OauthCallbackView(): E {
    const { formatMessage } = useIntl()
    return h(
      'main',
      null,
      h('meta', { httpEquiv: 'refresh', content: '0;url=/' }),
      h('h1', null, formatMessage('login/oauth/callback-heading')),
      h('p', null, h('a', { href: '/' }, formatMessage('login/oauth/callback-continue'))),
    )
  }
}
