import { h } from 'preact'
import type { VNode } from 'preact'
import { Button, Field, Input, useIntl } from '@zanix/space-ui/preact'
// A NAMED import — see `index.ts`'s own identical doc.
import { SubmitGuard } from '@zanix/space/comet/preact'
import { authHiddenFields } from 'ui/components/auth-hidden-fields/index.preact.ts'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createPhoneEnrollView } from './render.ts'
import type { PhoneEnrollViewDeps } from './render.ts'
import type { PhoneEnrollViewProps } from './types.ts'

export type { PhoneEnrollViewProps }

/** `iam`'s phone-verification enrollment view — see `index.ts`'s own doc. Preact binding, same
 * props, same rendered markup; import from `@zanix/iam/ui/pages/phone-enroll` for the React one. */
export const PhoneEnrollView: (props: PhoneEnrollViewProps) => VNode = createPhoneEnrollView<VNode>(
  h as unknown as CreateElement<VNode>,
  {
    useIntl,
    Button,
    Field,
    Input,
    SubmitGuard: SubmitGuard as unknown as PhoneEnrollViewDeps<VNode>['SubmitGuard'],
    authHiddenFields,
  },
)
