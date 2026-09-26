'use comet'

import { useSubmitIntercept } from '@zanix/space/comet/react'
import { defineComet } from '@zanix/space/comet'
import type { CometBoundaryComponent, CometProps } from '@zanix/space/comet'
import { createLoginTwoStep } from './render.ts'
import type { LoginTwoStepProps } from './types.ts'

export type { LoginTwoStepProps }

/**
 * The headless Comet of a two-step sign-in — see `render.ts`'s own doc. React binding, same
 * props; import from `./index.preact.ts` for the Preact one.
 */
export const LoginTwoStep: (props: LoginTwoStepProps) => null = createLoginTwoStep({
  useSubmitIntercept,
})

/** The `LoginTwoStep` Comet — its own hydration boundary; mount this default export,
 * not the raw named component. */
export default defineComet(LoginTwoStep, import.meta.url, 'LoginTwoStep') as CometBoundaryComponent<
  LoginTwoStepProps & CometProps
>
