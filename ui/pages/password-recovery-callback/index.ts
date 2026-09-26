import { createElement } from 'react'
import type { ReactElement } from 'react'
import { Button, Field, Input, useIntl } from '@zanix/space-ui'
// A NAMED import — see `login/index.ts`'s own identical doc, and why this project reaches for
// `ManagedForm` (draft + submitGuard, never `unsavedChanges`) here too.
import { ManagedForm } from '@zanix/space/comet/react'
import PasswordToggleField from 'ui/components/password-toggle-field/index.ts'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createRecoveryCallbackView } from './render.ts'
import type { RecoveryCallbackViewDeps } from './render.ts'
import type { RecoveryCallbackViewProps } from './types.ts'

export type { RecoveryCallbackViewProps }

/**
 * `iam`'s password-recovery confirmation view — a heading, an invalid-code banner, a mismatch
 * banner, and an email/code/new-password/confirm-password form (draft-recovering,
 * double-submit-guarded).
 *
 * React binding — import from `@zanix/iam/ui/pages/password-recovery-callback/preact` for the
 * Preact one.
 */
// Same overload-set cast `login/index.ts`'s own identical doc explains — `PasswordToggleField` is
// a `CometBoundaryComponent`, cast the same way.
export const RecoveryCallbackView: (props: RecoveryCallbackViewProps) => ReactElement =
  createRecoveryCallbackView<ReactElement>(
    createElement as unknown as CreateElement<ReactElement>,
    {
      useIntl,
      Button,
      Field,
      Input,
      PasswordToggleField: PasswordToggleField as unknown as RecoveryCallbackViewDeps<
        ReactElement
      >['PasswordToggleField'],
      ManagedForm: ManagedForm as unknown as RecoveryCallbackViewDeps<ReactElement>['ManagedForm'],
    },
  )
