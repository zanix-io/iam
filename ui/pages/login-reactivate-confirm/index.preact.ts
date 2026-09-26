import { h } from 'preact'
import type { VNode } from 'preact'
import { Button, useIntl } from '@zanix/space-ui/preact'
// A NAMED import — see `index.ts`'s own identical doc.
import { SubmitGuard } from '@zanix/space/comet/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createReactivateConfirmView } from './render.ts'
import type { ReactivateConfirmViewDeps } from './render.ts'
import type { ReactivateConfirmViewProps } from './types.ts'

export type { ReactivateConfirmViewProps }

/** `iam`'s reactivation-confirmation view — see `index.ts`'s own doc. Preact binding, same props,
 * same rendered markup; import from `@zanix/iam/ui/pages/login-reactivate-confirm` for the React
 * one. */
export const ReactivateConfirmView: (props: ReactivateConfirmViewProps) => VNode =
  createReactivateConfirmView<VNode>(
    h as unknown as CreateElement<VNode>,
    {
      useIntl,
      Button,
      SubmitGuard: SubmitGuard as unknown as ReactivateConfirmViewDeps<VNode>['SubmitGuard'],
    },
  )
