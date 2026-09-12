import type { Formatter } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import type { LogoutViewProps } from './types.ts'

/** This page's own `<form>` id — `SubmitGuard`'s own `formId` target. */
const FORM_ID = 'logout-form'

/** The `@zanix/space-ui` binding, hook, and Comet this view needs, injected alongside `h`. */
export type LogoutViewDeps<E> = {
  useIntl: () => Formatter
  Button: (props: { type?: 'button' | 'submit' | 'reset'; className?: string }) => E
  SubmitGuard: (props: { formId: string }) => E | null
}

/**
 * The real implementation of `iam`'s sign-out confirmation view, shared identically between the
 * React and Preact bindings (`index.ts`/`index.preact.ts`). This file never imports React,
 * Preact, or `@zanix/space-ui` itself.
 *
 * No draft persistence: this form has no field at all, just a confirm button — see the owning
 * page's own doc. `cancelUrl` renders a plain `<a>`, never a `Button`/`Link` component — a real
 * navigation, not an action, so it needs no injected dependency of its own. `className` on both
 * is a plain passthrough (`Button`'s own documented styling path) — this file has no opinion of
 * its own on how either looks, same "no component-owned visual default" discipline every
 * `@zanix/space-ui` leaf component already follows.
 */
export function createLogoutView<E>(
  h: CreateElement<E>,
  deps: LogoutViewDeps<E>,
): (props: LogoutViewProps) => E {
  const { useIntl, Button, SubmitGuard } = deps

  return function LogoutView({ cancelUrl }: LogoutViewProps): E {
    const { formatMessage } = useIntl()
    return h(
      'main',
      null,
      h('h1', null, formatMessage('logout/heading')),
      h('p', null, formatMessage('logout/confirm-description')),
      h(SubmitGuard, { formId: FORM_ID }),
      h(
        'form',
        { method: 'post', id: FORM_ID },
        h(
          'div',
          { 'data-space': 'auth-actions' },
          h(
            Button,
            { type: 'submit', className: 'btn btn-secondary' },
            formatMessage('logout/submit'),
          ),
          cancelUrl
            ? h(
              'a',
              { href: cancelUrl, className: 'btn btn-ghost' },
              formatMessage('logout/cancel-link'),
            )
            : null,
        ),
      ),
    )
  }
}
