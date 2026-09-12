import { h } from 'preact'
import type { ComponentChildren, VNode } from 'preact'
import { IntlProvider } from '@zanix/space-ui/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createLangLayout } from './render.ts'
import type { LangLayoutViewData, LangLayoutViewProps } from './types.ts'

export type { LangLayoutViewData, LangLayoutViewProps }

/**
 * `iam`'s root document shell — see `index.ts`'s own doc for the full description. Preact
 * binding, same props, same rendered markup; import from `@zanix/iam/ui/pages/lang-layout` for
 * the React one.
 */
// Same overload-set cast `index.ts`'s own React binding uses — `h` is overloaded per-tag the same
// way `React.createElement` is.
export const LangLayout: (props: LangLayoutViewProps<ComponentChildren, VNode>) => VNode =
  createLangLayout<ComponentChildren, VNode>(
    h as unknown as CreateElement<VNode>,
    {
      // The real `h(IntlProvider, ...)` call — see `index.ts`'s own identical doc. Cast for the
      // same overload-set reason as this file's own `h as unknown as CreateElement<VNode>` above:
      // `h`'s real overload set infers a narrower `VNode<IntlProviderProps>` here, which
      // `renderIntlProvider`'s own declared return type (`VNode<{}>`, `VNode`'s default) doesn't
      // structurally accept without this cast — the runtime value is a real, correct `VNode`
      // either way.
      renderIntlProvider: (locale, messages, children) =>
        h(IntlProvider, { locale, messages, children }) as VNode,
    },
  )
