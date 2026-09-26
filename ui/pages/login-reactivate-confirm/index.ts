import { createElement } from 'react'
import type { ReactElement } from 'react'
import { Button, useIntl } from '@zanix/space-ui'
// A NAMED import — see `login-totp/index.ts`'s own identical doc. No draft persistence: a
// one-shot confirm submit, same reasoning as `login-otp/index.ts`.
import { SubmitGuard } from '@zanix/space/comet/react'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createReactivateConfirmView } from './render.ts'
import type { ReactivateConfirmViewDeps } from './render.ts'
import type { ReactivateConfirmViewProps } from './types.ts'

export type { ReactivateConfirmViewProps }

/**
 * `iam`'s reactivation-confirmation view — a heading, an explanation that continuing reactivates
 * the account, a confirm submit, and a link back to sign-in.
 *
 * React binding — import from `@zanix/iam/ui/pages/login-reactivate-confirm/preact` for the
 * Preact one.
 */
export const ReactivateConfirmView: (props: ReactivateConfirmViewProps) => ReactElement =
  createReactivateConfirmView<ReactElement>(
    createElement as unknown as CreateElement<ReactElement>,
    {
      useIntl,
      Button,
      SubmitGuard: SubmitGuard as unknown as ReactivateConfirmViewDeps<ReactElement>['SubmitGuard'],
    },
  )
