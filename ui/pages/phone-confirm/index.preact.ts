import { h } from 'preact'
import type { VNode } from 'preact'
import { Button, Field, Input, useIntl } from '@zanix/space-ui/preact'
// A NAMED import — see `index.ts`'s own identical doc.
import { SubmitGuard } from '@zanix/space/comet/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createPhoneConfirmView } from './render.ts'
import type { PhoneConfirmViewDeps } from './render.ts'
import type { PhoneConfirmViewProps } from './types.ts'

export type { PhoneConfirmViewProps }

/** `iam`'s phone-verification confirmation view — see `index.ts`'s own doc. Preact binding, same
 * props, same rendered markup; import from `@zanix/iam/ui/pages/phone-confirm` for the React one. */
export const PhoneConfirmView: (props: PhoneConfirmViewProps) => VNode = createPhoneConfirmView<
  VNode
>(
  h as unknown as CreateElement<VNode>,
  {
    useIntl,
    Button,
    Field,
    Input,
    SubmitGuard: SubmitGuard as unknown as PhoneConfirmViewDeps<VNode>['SubmitGuard'],
  },
)
