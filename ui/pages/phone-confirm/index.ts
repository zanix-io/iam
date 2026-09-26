import { createElement } from 'react'
import type { ReactElement } from 'react'
import { Button, Field, Input, useIntl } from '@zanix/space-ui'
// A NAMED import — see `login/index.ts`'s own identical doc. No draft persistence: same
// single-use-code reasoning as `login-otp/index.ts`.
import { SubmitGuard } from '@zanix/space/comet/react'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createPhoneConfirmView } from './render.ts'
import type { PhoneConfirmViewDeps } from './render.ts'
import type { PhoneConfirmViewProps } from './types.ts'

export type { PhoneConfirmViewProps }

/**
 * `iam`'s phone-verification confirmation view — a code field plus the `phone` `../enroll` already
 * dispatched a code to.
 *
 * React binding — import from `@zanix/iam/ui/pages/phone-confirm/preact` for the Preact one.
 */
export const PhoneConfirmView: (props: PhoneConfirmViewProps) => ReactElement =
  createPhoneConfirmView<ReactElement>(
    createElement as unknown as CreateElement<ReactElement>,
    {
      useIntl,
      Button,
      Field,
      Input,
      SubmitGuard: SubmitGuard as unknown as PhoneConfirmViewDeps<ReactElement>['SubmitGuard'],
    },
  )
