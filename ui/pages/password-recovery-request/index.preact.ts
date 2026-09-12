import { h } from 'preact'
import type { VNode } from 'preact'
import { useIntl } from '@zanix/space-ui/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createRecoveryRequestView } from './render.ts'
import type { RecoveryRequestViewProps } from './types.ts'

export type { RecoveryRequestViewProps }

/** `iam`'s password-recovery request view — see `index.ts`'s own doc. Preact binding, same
 * props, same rendered markup. */
export const RecoveryRequestView: (props: RecoveryRequestViewProps) => VNode =
  createRecoveryRequestView(
    h as unknown as CreateElement<VNode>,
    { useIntl },
  )
