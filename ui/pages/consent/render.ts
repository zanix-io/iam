import type { Formatter } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import type { ConsentViewProps } from './types.ts'

/** The `useIntl` hook this view needs, injected alongside `h` — `index.ts`/`index.preact.ts` each
 * supply their own renderer's real, already-bound copy. */
export type ConsentViewDeps = {
  useIntl: () => Formatter
}

/**
 * The real implementation of `iam`'s cookie-consent fallback view, shared identically between the
 * React and Preact bindings (`index.ts`/`index.preact.ts`). This file never imports React, Preact,
 * or `@zanix/space-ui` itself.
 *
 * A minimal fallback — the owning page exists purely for its own `action`; the consent modal's own
 * `fetch()` call (never a real browser navigation) is the only real caller. A page's `GET` is
 * still always a real, spec-valid document, so this renders something real rather than nothing, on
 * the rare chance someone loads this URL directly.
 */
export function createConsentView<E>(
  h: CreateElement<E>,
  deps: ConsentViewDeps,
): (props: ConsentViewProps) => E {
  const { useIntl } = deps

  return function ConsentView(): E {
    const { formatMessage } = useIntl()
    return h('main', null, h('h1', null, formatMessage('consent/heading')))
  }
}
