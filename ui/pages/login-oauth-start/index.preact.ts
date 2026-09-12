import { h } from 'preact'
import type { VNode } from 'preact'
import { Button, useIntl } from '@zanix/space-ui/preact'
import { SubmitGuard } from '@zanix/space/comet/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createOauthStartView } from './render.ts'
import type { OauthStartViewDeps } from './render.ts'
import type { OauthStartViewProps } from './types.ts'

export type { OauthStartViewProps }

/** `iam`'s OAuth2 start-confirmation view — see `index.ts`'s own doc. Preact binding, same
 * props, same rendered markup. */
export const OauthStartView: (props: OauthStartViewProps) => VNode = createOauthStartView(
  h as unknown as CreateElement<VNode>,
  {
    useIntl,
    Button,
    SubmitGuard: SubmitGuard as unknown as OauthStartViewDeps<VNode>['SubmitGuard'],
  },
)
