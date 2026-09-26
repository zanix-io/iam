import { createElement } from 'react'
import type { ReactElement } from 'react'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createAuthHiddenFields } from './render.ts'
import type { AuthHiddenFieldsProps } from './types.ts'

export type { AuthHiddenFieldsProps }

/**
 * `authHiddenFields` — see `render.ts`'s own doc for the full description. A plain function
 * returning an array of two `<input type="hidden">` elements, NOT a component (never `h(
 * authHiddenFields, props)`) — spread directly into the surrounding `<form>`'s own children.
 *
 * React binding — import `./index.preact.ts` for the Preact one, same contract.
 */
export const authHiddenFields: (props: AuthHiddenFieldsProps) => ReactElement[] =
  createAuthHiddenFields(
    createElement as unknown as CreateElement<ReactElement>,
  )
