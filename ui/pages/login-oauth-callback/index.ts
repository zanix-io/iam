import { createElement } from 'react'
import type { ReactElement } from 'react'
import { useIntl } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createOauthCallbackView } from './render.ts'
import type { OauthCallbackViewProps } from './types.ts'

export type { OauthCallbackViewProps }

/**
 * `iam`'s OAuth2 sign-in interstitial — see `render.ts`'s own doc for the full description. React
 * binding — import from `@zanix/iam/ui/pages/login-oauth-callback/preact` for the Preact one.
 */
export const OauthCallbackView: (props: OauthCallbackViewProps) => ReactElement =
  createOauthCallbackView(
    createElement as unknown as CreateElement<ReactElement>,
    { useIntl },
  )
