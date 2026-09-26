'use comet'

import { h } from 'preact'
import type { VNode } from 'preact'
import { PasswordInput } from '@zanix/space-ui/preact'
import { defineComet } from '@zanix/space/comet'
import type { CometBoundaryComponent, CometProps } from '@zanix/space/comet'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createPasswordToggleField } from './render.ts'
import type { PasswordToggleFieldProps } from './types.ts'

export type { PasswordToggleFieldProps }

/**
 * A password field's visibility-toggle Comet — see `index.ts`'s own doc for the full description.
 * Preact binding, same props, same rendered markup; import from `./index.ts` for the React one.
 */
// Same overload-set cast, and same factory-returned-name caveat, `index.ts`'s own React binding
// documents in full.
export const PasswordToggleField: (props: PasswordToggleFieldProps) => VNode =
  createPasswordToggleField<VNode>(
    h as unknown as CreateElement<VNode>,
    { PasswordInput: PasswordInput as unknown as (props: Record<string, unknown>) => VNode },
  )

// Same `as CometBoundaryComponent<...>` clause `index.ts`'s own doc explains in full — required
// now that this file is part of `iam`'s own public `exports`.
/** The `PasswordToggleField` Comet — its own hydration boundary; mount this default export,
 * not the raw named component. */
export default defineComet(
  PasswordToggleField,
  import.meta.url,
  'PasswordToggleField',
) as CometBoundaryComponent<PasswordToggleFieldProps & CometProps>
