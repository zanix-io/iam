import type { Formatter } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import type { TotpConfirmViewProps } from './types.ts'

/** The `useIntl` hook this view needs, injected alongside `h`. */
export type TotpConfirmViewDeps = {
  useIntl: () => Formatter
}

/**
 * The real implementation of `iam`'s TOTP-confirmation fallback view, shared identically between
 * the React and Preact bindings (`index.ts`/`index.preact.ts`). This file never imports React,
 * Preact, or `@zanix/space-ui` itself.
 *
 * Never actually rendered in practice — the owning page's own `static redirect` fires
 * unconditionally on every `GET`, before `component` ever runs. Still required:
 * `SpacePageController.component` is `abstract`, the same reason `iam`'s own `LogoutPage`'s view
 * exists in a page whose `action` is its only real path.
 */
export function createTotpConfirmView<E>(
  h: CreateElement<E>,
  deps: TotpConfirmViewDeps,
): (props: TotpConfirmViewProps) => E {
  const { useIntl } = deps

  return function TotpConfirmView(): E {
    const { formatMessage } = useIntl()
    return h('main', null, h('h1', null, formatMessage('totp/confirm/heading')))
  }
}
