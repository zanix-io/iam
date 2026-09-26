import { createElement } from 'react'
import type { ReactElement } from 'react'
import { useIntl } from '@zanix/space-ui'
import { LoginView } from 'ui/pages/login/index.ts'
import { LoginPasswordStep } from 'ui/components/login-password-step/index.ts'
// This project's own Comet — see `ui/pages/login/index.ts`'s own doc on default-exported Comets.
import LoginTwoStep from 'ui/components/login-two-step/index.ts'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createLoginEntryView } from './render.ts'
import type { LoginEntryViewDeps } from './render.ts'
import type { LoginEntryViewProps } from './types.ts'

export type { LoginEntryData, LoginEntryViewProps } from './types.ts'

/**
 * The two-step sign-in screen — see `render.ts`'s own doc. React binding, same props and markup;
 * import from `./index.preact.ts` for the Preact one.
 */
export const LoginEntryView: (props: LoginEntryViewProps<ReactElement>) => ReactElement =
  createLoginEntryView<
    ReactElement
  >(
    createElement as unknown as CreateElement<ReactElement>,
    {
      useIntl,
      LoginView,
      LoginPasswordStep,
      LoginTwoStep: LoginTwoStep as unknown as LoginEntryViewDeps<ReactElement>['LoginTwoStep'],
    },
  )
