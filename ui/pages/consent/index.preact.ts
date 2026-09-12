import { h } from 'preact'
import type { VNode } from 'preact'
import { useIntl } from '@zanix/space-ui/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createConsentView } from './render.ts'
import type { ConsentViewProps } from './types.ts'

export type { ConsentViewProps }

/** `iam`'s cookie-consent fallback view — see `index.ts`'s own doc for the full description.
 * Preact binding, same props, same rendered markup. */
export const ConsentView: (props: ConsentViewProps) => VNode = createConsentView(
  h as unknown as CreateElement<VNode>,
  { useIntl },
)
