import { createElement } from 'react'
import type { ReactElement } from 'react'
import { useIntl } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createRecoveryRequestView } from './render.ts'
import type { RecoveryRequestViewProps } from './types.ts'

export type { RecoveryRequestViewProps }

/**
 * `iam`'s password-recovery request view — see `render.ts`'s own doc. React binding — import
 * from `@zanix/iam/ui/pages/password-recovery-request/preact` for the Preact one.
 */
export const RecoveryRequestView: (props: RecoveryRequestViewProps) => ReactElement =
  createRecoveryRequestView(
    createElement as unknown as CreateElement<ReactElement>,
    { useIntl },
  )
