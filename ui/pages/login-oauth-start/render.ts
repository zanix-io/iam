import type { Formatter } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import type { OauthStartViewProps } from './types.ts'

/** This page's own `<form>` id — `SubmitGuard`'s own `formId` target. */
const FORM_ID = 'login-oauth-form'

/**
 * The `@zanix/space-ui` binding, hook, and Comet this view needs, injected alongside `h` —
 * `index.ts`/`index.preact.ts` each supply their own renderer's real, already-bound copies.
 * `Button`/`SubmitGuard` are both passed through `h` as component REFERENCES (`h(Button, props,
 * ...)`), never called directly — see `ui/typings/renderer.ts`'s own `CreateElement` doc for why.
 */
export type OauthStartViewDeps<E> = {
  useIntl: () => Formatter
  Button: (props: { type?: 'button' | 'submit' | 'reset' }) => E
  SubmitGuard: (props: { formId: string }) => E | null
}

/**
 * The real implementation of `iam`'s OAuth2 start-confirmation view, shared identically between
 * the React and Preact bindings (`index.ts`/`index.preact.ts`). This file never imports React,
 * Preact, or `@zanix/space-ui` itself.
 *
 * An intermediate confirmation screen, not an immediate GET redirect — the owning page's own doc
 * explains why the actual redirect can only happen from a `POST` this view renders as a real,
 * CSRF-protected form.
 */
export function createOauthStartView<E>(
  h: CreateElement<E>,
  deps: OauthStartViewDeps<E>,
): (props: OauthStartViewProps) => E {
  const { useIntl, Button, SubmitGuard } = deps

  return function OauthStartView({ lang, oauth, csrfToken }: OauthStartViewProps): E {
    const { formatMessage } = useIntl()
    // Same 'login/oauth-continue' key `login/page.tsx`'s own provider list already formats — one
    // catalog entry for "Continue with {provider}" everywhere that exact phrase renders.
    const continueLabel = formatMessage('login/oauth-continue', { provider: oauth })

    return h(
      'main',
      null,
      h('h1', null, continueLabel),
      h(SubmitGuard, { formId: FORM_ID }),
      h(
        'form',
        { method: 'post', id: FORM_ID },
        h('input', { type: 'hidden', name: '_csrf', value: csrfToken ?? '' }),
        h(Button, { type: 'submit' }, continueLabel),
      ),
      h(
        'p',
        null,
        h('a', { href: `/${lang}/login` }, formatMessage('common/back-to-sign-in')),
      ),
    )
  }
}
