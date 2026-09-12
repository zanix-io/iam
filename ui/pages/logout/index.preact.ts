import { h } from 'preact'
import type { VNode } from 'preact'
import { Button, useIntl } from '@zanix/space-ui/preact'
// A NAMED import — see `index.ts`'s own identical doc.
import { SubmitGuard } from '@zanix/space/comet/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createLogoutView } from './render.ts'
import type { LogoutViewDeps } from './render.ts'
import type { LogoutViewProps } from './types.ts'

export type { LogoutViewProps }

/** `iam`'s sign-out confirmation view — see `index.ts`'s own doc. Preact binding, same props,
 * same rendered markup; import from `@zanix/iam/ui/pages/logout` for the React one. */
export const LogoutView: (props: LogoutViewProps) => VNode = createLogoutView<VNode>(
  h as unknown as CreateElement<VNode>,
  {
    useIntl,
    Button,
    SubmitGuard: SubmitGuard as unknown as LogoutViewDeps<VNode>['SubmitGuard'],
  },
)
