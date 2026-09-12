import { createElement } from 'react'
import type { ReactElement } from 'react'
import { Button, Field, Input, useIntl } from '@zanix/space-ui'
// A NAMED import — see `login/index.ts`'s own identical doc. No draft persistence here: an OTP
// code is a short-lived, single-use value.
import { SubmitGuard } from '@zanix/space/comet/react'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createOtpView } from './render.ts'
import type { OtpViewDeps } from './render.ts'
import type { OtpViewProps } from './types.ts'

export type { OtpViewProps }

/**
 * `iam`'s OTP second-factor challenge view — a heading, the destination the code was sent to, a
 * single verification-code field, and a link back to sign-in.
 *
 * React binding — import from `@zanix/iam/ui/pages/login-otp/preact` for the Preact one.
 */
export const OtpView: (props: OtpViewProps) => ReactElement = createOtpView<ReactElement>(
  createElement as unknown as CreateElement<ReactElement>,
  {
    useIntl,
    Button,
    Field,
    Input,
    SubmitGuard: SubmitGuard as unknown as OtpViewDeps<ReactElement>['SubmitGuard'],
  },
)
