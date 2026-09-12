import { createElement } from 'react'
import type { ReactElement } from 'react'
import { Button, useIntl } from '@zanix/space-ui'
// A NAMED import — see `login/index.ts`'s own identical doc. No draft persistence: this form has
// no field at all, just a confirm button.
import { SubmitGuard } from '@zanix/space/comet/react'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createLogoutView } from './render.ts'
import type { LogoutViewDeps } from './render.ts'
import type { LogoutViewProps } from './types.ts'

export type { LogoutViewProps }

/**
 * `iam`'s sign-out confirmation view — a heading and a confirm button.
 *
 * React binding — import from `@zanix/iam/ui/pages/logout/preact` for the Preact one.
 */
export const LogoutView: (props: LogoutViewProps) => ReactElement = createLogoutView<
  ReactElement
>(
  createElement as unknown as CreateElement<ReactElement>,
  {
    useIntl,
    Button,
    SubmitGuard: SubmitGuard as unknown as LogoutViewDeps<ReactElement>['SubmitGuard'],
  },
)
