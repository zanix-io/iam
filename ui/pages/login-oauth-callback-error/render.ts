import type { Formatter } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import type { OauthCallbackErrorViewProps } from './types.ts'

/**
 * The `@zanix/space-ui` binding and hook this view needs, injected alongside `h`. `Button` is
 * passed through `h` as a component REFERENCE (`h(Button, props, ...)`), never called directly —
 * see `ui/typings/renderer.ts`'s own `CreateElement` doc for why.
 */
export type OauthCallbackErrorViewDeps<E> = {
  useIntl: () => Formatter
  Button: (props: { onClick?: () => void }) => E
}

/**
 * The real implementation of `iam`'s OAuth2 sign-in error boundary, shared identically between
 * the React and Preact bindings (`index.ts`/`index.preact.ts`). This file never imports React,
 * Preact, or `@zanix/space-ui` itself.
 *
 * Friendly fallback for the owning route's own `loader` throwing — an expired/invalid
 * authorization code, an unverified provider email, or an account already linked to a different
 * sign-in method. Never renders the raw thrown error to the visitor — this is an end-user-facing
 * page, not a maintainer log; the real error detail is left to `iam`'s own server-side error
 * logging, unchanged by this boundary.
 */
export function createOauthCallbackErrorView<E>(
  h: CreateElement<E>,
  deps: OauthCallbackErrorViewDeps<E>,
): (props: OauthCallbackErrorViewProps) => E {
  const { useIntl, Button } = deps

  return function OauthCallbackErrorView({ params, reset }: OauthCallbackErrorViewProps): E {
    const lang = (params as { lang?: string })?.lang ?? 'en'
    const { formatMessage } = useIntl()
    return h(
      'main',
      { 'data-space': 'error' },
      h('h1', null, formatMessage('login/oauth/error-heading')),
      h('p', null, formatMessage('login/oauth/error-body')),
      h(
        'p',
        { 'data-space': 'auth-back-link' },
        h('a', { href: `/${lang}/login` }, formatMessage('common/back-to-sign-in')),
      ),
      h(Button, { onClick: reset }, formatMessage('common/try-again')),
    )
  }
}
