import { h } from 'preact'
import type { VNode } from 'preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createAuthHiddenFields } from './render.ts'
import type { AuthHiddenFieldsProps } from './types.ts'

export type { AuthHiddenFieldsProps }

/**
 * `authHiddenFields` — see `render.ts`'s own doc for the full description. Preact binding, same
 * contract; import from `./index.ts` for the React one.
 */
export const authHiddenFields: (props: AuthHiddenFieldsProps) => VNode[] = createAuthHiddenFields(
  h as unknown as CreateElement<VNode>,
)
