'use comet'

import { h } from 'preact'
import type { VNode } from 'preact'
import { PasswordInput } from '@zanix/space-ui/preact'
import { defineComet } from '@zanix/space/comet'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createPasswordToggleField } from './render.ts'
import type { PasswordToggleFieldProps } from './types.ts'

export type { PasswordToggleFieldProps }

/**
 * The login page's password visibility-toggle Comet — see `index.ts`'s own doc for the full
 * description. Preact binding, same props, same rendered markup; import from `./index.ts` for the
 * React one.
 */
// Same overload-set cast, and same factory-returned-name caveat, `index.ts`'s own React binding
// documents in full.
export const PasswordToggleField: (props: PasswordToggleFieldProps) => VNode =
  createPasswordToggleField<VNode>(
    h as unknown as CreateElement<VNode>,
    { PasswordInput: PasswordInput as unknown as (props: Record<string, unknown>) => VNode },
  )

export default defineComet(PasswordToggleField, import.meta.url, 'PasswordToggleField')
