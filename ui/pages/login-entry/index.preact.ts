import { h } from 'preact'
import type { VNode } from 'preact'
import { useIntl } from '@zanix/space-ui/preact'
import { LoginView } from 'ui/pages/login/index.preact.ts'
import { LoginPasswordStep } from 'ui/components/login-password-step/index.preact.ts'
// This project's own Comet — see `ui/pages/login/index.ts`'s own doc on default-exported Comets.
import LoginTwoStep from 'ui/components/login-two-step/index.preact.ts'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createLoginEntryView } from './render.ts'
import type { LoginEntryViewDeps } from './render.ts'
import type { LoginEntryViewProps } from './types.ts'

export type { LoginEntryData, LoginEntryViewProps } from './types.ts'

/**
 * The two-step sign-in screen — see `render.ts`'s own doc. Preact binding, same props and markup;
 * import from `./index.ts` for the React one.
 */
export const LoginEntryView: (props: LoginEntryViewProps<VNode>) => VNode = createLoginEntryView<
  VNode
>(
  h as unknown as CreateElement<VNode>,
  {
    useIntl,
    LoginView,
    LoginPasswordStep,
    LoginTwoStep: LoginTwoStep as unknown as LoginEntryViewDeps<VNode>['LoginTwoStep'],
  },
)
