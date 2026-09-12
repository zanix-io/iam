import { createElement } from 'react'
import type { ReactElement } from 'react'
import { Button, useIntl } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createOauthCallbackErrorView } from './render.ts'
import type { OauthCallbackErrorViewDeps } from './render.ts'
import type { OauthCallbackErrorViewProps } from './types.ts'

export type { OauthCallbackErrorViewProps }

/**
 * `iam`'s OAuth2 sign-in error boundary — see `render.ts`'s own doc. React binding — import from
 * `@zanix/iam/ui/pages/login-oauth-callback-error/preact` for the Preact one.
 */
export const OauthCallbackErrorView: (props: OauthCallbackErrorViewProps) => ReactElement =
  createOauthCallbackErrorView<ReactElement>(
    createElement as unknown as CreateElement<ReactElement>,
    { useIntl, Button: Button as unknown as OauthCallbackErrorViewDeps<ReactElement>['Button'] },
  )
