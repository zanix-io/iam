import { createElement } from 'react'
import type { ReactElement } from 'react'
import { Button, Field, Input, useIntl } from '@zanix/space-ui'
// A NAMED import — see `login/index.ts`'s own identical doc. No draft persistence: same
// single-use-code reasoning as `login-otp/index.ts`.
import { SubmitGuard } from '@zanix/space/comet/react'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createTotpEnrollView } from './render.ts'
import type { TotpEnrollViewDeps } from './render.ts'
import type { TotpEnrollViewProps } from './types.ts'

export type { TotpEnrollViewProps }

/**
 * `iam`'s TOTP enrollment view — a scannable QR code, the manual secret/link fallback, and a
 * confirmation-code form posting to the sibling `totp/confirm` page.
 *
 * React binding — import from `@zanix/iam/ui/pages/totp-enroll/preact` for the Preact one.
 */
export const TotpEnrollView: (props: TotpEnrollViewProps) => ReactElement = createTotpEnrollView<
  ReactElement
>(
  createElement as unknown as CreateElement<ReactElement>,
  {
    useIntl,
    Button,
    Field,
    Input,
    SubmitGuard: SubmitGuard as unknown as TotpEnrollViewDeps<ReactElement>['SubmitGuard'],
  },
)
