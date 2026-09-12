import type { Formatter } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import type { RecoveryRequestViewProps } from './types.ts'

/** The `useIntl` hook this view needs, injected alongside `h`. */
export type RecoveryRequestViewDeps = {
  useIntl: () => Formatter
}

/**
 * The real implementation of `iam`'s password-recovery REQUEST view, shared identically between
 * the React and Preact bindings (`index.ts`/`index.preact.ts`). This file never imports React,
 * Preact, or `@zanix/space-ui` itself.
 *
 * A confirmation-only view — dispatching the recovery code is this page's own `loader` side
 * effect (see the owning page's own doc); this view only ever tells the visitor it happened and
 * links to the confirmation step.
 */
export function createRecoveryRequestView<E>(
  h: CreateElement<E>,
  deps: RecoveryRequestViewDeps,
): (props: RecoveryRequestViewProps) => E {
  const { useIntl } = deps

  return function RecoveryRequestView({ lang, email }: RecoveryRequestViewProps): E {
    const { formatMessage } = useIntl()
    return h(
      'main',
      null,
      h('h1', null, formatMessage('password/recovery/request-heading')),
      h('p', null, formatMessage('password/recovery/request-body', { email })),
      h(
        'p',
        null,
        h(
          'a',
          { href: `/${lang}/password/recovery/callback?email=${encodeURIComponent(email)}` },
          formatMessage('password/recovery/have-code-link'),
        ),
      ),
    )
  }
}
