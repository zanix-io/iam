import { h } from 'preact'
import type { VNode } from 'preact'
import { Button, useIntl } from '@zanix/space-ui/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createOauthCallbackErrorView } from './render.ts'
import type { OauthCallbackErrorViewDeps } from './render.ts'
import type { OauthCallbackErrorViewProps } from './types.ts'

export type { OauthCallbackErrorViewProps }

/** `iam`'s OAuth2 sign-in error boundary — see `index.ts`'s own doc. Preact binding, same props,
 * same rendered markup; import from `@zanix/iam/ui/pages/login-oauth-callback-error` for the
 * React one. */
export const OauthCallbackErrorView: (props: OauthCallbackErrorViewProps) => VNode =
  createOauthCallbackErrorView<VNode>(
    h as unknown as CreateElement<VNode>,
    { useIntl, Button: Button as unknown as OauthCallbackErrorViewDeps<VNode>['Button'] },
  )
