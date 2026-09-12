import { h } from 'preact'
import type { VNode } from 'preact'
import { Button, Field, Input, useIntl } from '@zanix/space-ui/preact'
// A NAMED import — see `index.ts`'s own identical doc.
import { SubmitGuard } from '@zanix/space/comet/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createTotpLoginView } from './render.ts'
import type { TotpViewDeps } from './render.ts'
import type { TotpViewProps } from './types.ts'

export type { TotpViewProps }

/** `iam`'s TOTP second-factor LOGIN challenge view — see `index.ts`'s own doc. Preact binding,
 * same props, same rendered markup; import from `@zanix/iam/ui/pages/login-totp` for the React
 * one. */
export const TotpLoginView: (props: TotpViewProps) => VNode = createTotpLoginView<VNode>(
  h as unknown as CreateElement<VNode>,
  {
    useIntl,
    Button,
    Field,
    Input,
    SubmitGuard: SubmitGuard as unknown as TotpViewDeps<VNode>['SubmitGuard'],
  },
)
