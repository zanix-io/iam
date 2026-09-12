import { h } from 'preact'
import type { VNode } from 'preact'
import { useIntl } from '@zanix/space-ui/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createOauthCallbackView } from './render.ts'
import type { OauthCallbackViewProps } from './types.ts'

export type { OauthCallbackViewProps }

/** `iam`'s OAuth2 sign-in interstitial — see `index.ts`'s own doc. Preact binding, same props,
 * same rendered markup. */
export const OauthCallbackView: (props: OauthCallbackViewProps) => VNode = createOauthCallbackView(
  h as unknown as CreateElement<VNode>,
  { useIntl },
)
