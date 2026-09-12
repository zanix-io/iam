import { createElement } from 'react'
import type { ReactElement } from 'react'
import { useIntl } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createConsentView } from './render.ts'
import type { ConsentViewProps } from './types.ts'

export type { ConsentViewProps }

/**
 * `iam`'s cookie-consent fallback view — see `render.ts`'s own doc for the full description.
 * React binding — import from `@zanix/iam/ui/pages/consent/preact` for the Preact one.
 */
export const ConsentView: (props: ConsentViewProps) => ReactElement = createConsentView(
  createElement as unknown as CreateElement<ReactElement>,
  { useIntl },
)
