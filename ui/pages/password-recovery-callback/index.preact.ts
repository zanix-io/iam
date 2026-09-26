import { h } from 'preact'
import type { VNode } from 'preact'
import { Button, Field, Input, useIntl } from '@zanix/space-ui/preact'
// A NAMED import — see `index.ts`'s own identical doc.
import { ManagedForm } from '@zanix/space/comet/preact'
import PasswordToggleField from 'ui/components/password-toggle-field/index.preact.ts'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createRecoveryCallbackView } from './render.ts'
import type { RecoveryCallbackViewDeps } from './render.ts'
import type { RecoveryCallbackViewProps } from './types.ts'

export type { RecoveryCallbackViewProps }

/** `iam`'s password-recovery confirmation view — see `index.ts`'s own doc. Preact binding, same
 * props, same rendered markup; import from `@zanix/iam/ui/pages/password-recovery-callback` for
 * the React one. */
export const RecoveryCallbackView: (props: RecoveryCallbackViewProps) => VNode =
  createRecoveryCallbackView<VNode>(
    h as unknown as CreateElement<VNode>,
    {
      useIntl,
      Button,
      Field,
      Input,
      PasswordToggleField: PasswordToggleField as unknown as RecoveryCallbackViewDeps<
        VNode
      >['PasswordToggleField'],
      ManagedForm: ManagedForm as unknown as RecoveryCallbackViewDeps<VNode>['ManagedForm'],
    },
  )
