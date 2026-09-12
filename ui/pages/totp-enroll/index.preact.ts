import { h } from 'preact'
import type { VNode } from 'preact'
import { Button, Field, Input, useIntl } from '@zanix/space-ui/preact'
// A NAMED import — see `index.ts`'s own identical doc.
import { SubmitGuard } from '@zanix/space/comet/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createTotpEnrollView } from './render.ts'
import type { TotpEnrollViewDeps } from './render.ts'
import type { TotpEnrollViewProps } from './types.ts'

export type { TotpEnrollViewProps }

/** `iam`'s TOTP enrollment view — see `index.ts`'s own doc. Preact binding, same props, same
 * rendered markup; import from `@zanix/iam/ui/pages/totp-enroll` for the React one. */
export const TotpEnrollView: (props: TotpEnrollViewProps) => VNode = createTotpEnrollView<VNode>(
  h as unknown as CreateElement<VNode>,
  {
    useIntl,
    Button,
    Field,
    Input,
    SubmitGuard: SubmitGuard as unknown as TotpEnrollViewDeps<VNode>['SubmitGuard'],
  },
)
