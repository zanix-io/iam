import { createElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { IntlProvider } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createLangLayout } from './render.ts'
import type { LangLayoutViewData, LangLayoutViewProps } from './types.ts'

export type { LangLayoutViewData, LangLayoutViewProps }

/**
 * `iam`'s root document shell — see `render.ts`'s own doc for the full description, including why
 * `data.cookieConsentSlot` arrives pre-built rather than this view importing the Comet itself.
 * React binding — import from `@zanix/iam/ui/pages/lang-layout/preact` for the Preact one.
 */
// Same overload-set cast `@zanix/space-ui`'s own component bindings use — see
// `pages/login/index.ts`'s own identical doc.
export const LangLayout: (props: LangLayoutViewProps<ReactNode, ReactElement>) => ReactElement =
  createLangLayout<ReactNode, ReactElement>(
    createElement as unknown as CreateElement<ReactElement>,
    {
      // The real `createElement(IntlProvider, ...)` call — `IntlProvider` referenced as a
      // component, never invoked directly (see `render.ts`'s own doc for why that distinction
      // matters here specifically).
      renderIntlProvider: (locale, messages, children) =>
        createElement(IntlProvider, { locale, messages, children }),
    },
  )
