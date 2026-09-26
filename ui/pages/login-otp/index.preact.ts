import { h } from 'preact'
import type { VNode } from 'preact'
import { Button, Field, Input, useIntl } from '@zanix/space-ui/preact'
// A NAMED import — see `index.ts`'s own identical doc.
import { SubmitGuard } from '@zanix/space/comet/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { authHiddenFields } from 'ui/components/auth-hidden-fields/index.preact.ts'
import OtpResend from 'ui/components/otp-resend/index.preact.ts'
import { createOtpView } from './render.ts'
import type { OtpViewDeps } from './render.ts'
import type { OtpViewProps } from './types.ts'

export type { OtpViewProps }

/** `iam`'s OTP second-factor challenge view — see `index.ts`'s own doc. Preact binding, same
 * props, same rendered markup; import from `@zanix/iam/ui/pages/login-otp` for the React one. */
export const OtpView: (props: OtpViewProps) => VNode = createOtpView<VNode>(
  h as unknown as CreateElement<VNode>,
  {
    useIntl,
    Button,
    Field,
    Input,
    SubmitGuard: SubmitGuard as unknown as OtpViewDeps<VNode>['SubmitGuard'],
    authHiddenFields,
    OtpResend: OtpResend as unknown as OtpViewDeps<VNode>['OtpResend'],
  },
)
