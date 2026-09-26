import { createElement } from 'react'
import type { ReactElement } from 'react'
import { Button, Field, Link } from '@zanix/space-ui'
// These are this project's own Comets and helpers — see `login/index.ts`'s own doc.
import PasswordToggleField from 'ui/components/password-toggle-field/index.ts'
import { RateLimitCard } from 'ui/components/rate-limit-card/index.ts'
import { authHiddenFields } from 'ui/components/auth-hidden-fields/index.ts'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createLoginPasswordStep } from './render.ts'
import type { LoginPasswordStepDeps } from './render.ts'
import type { LoginPasswordStepProps } from './types.ts'

export type {
  LoginPasswordStepLabels,
  LoginPasswordStepOptions,
  LoginPasswordStepProps,
} from './types.ts'

/**
 * The password step of a two-step sign-in — see `render.ts`'s own doc. Preact binding; import from
 * `./index.ts` for the React one, same props, same markup.
 */
export const LoginPasswordStep: (props: LoginPasswordStepProps) => ReactElement =
  createLoginPasswordStep<
    ReactElement
  >(
    createElement as unknown as CreateElement<ReactElement>,
    {
      Button: Button as unknown as LoginPasswordStepDeps<ReactElement>['Button'],
      Field: Field as unknown as LoginPasswordStepDeps<ReactElement>['Field'],
      Link: Link as unknown as LoginPasswordStepDeps<ReactElement>['Link'],
      PasswordToggleField: PasswordToggleField as unknown as LoginPasswordStepDeps<
        ReactElement
      >['PasswordToggleField'],
      RateLimitCard: RateLimitCard as unknown as LoginPasswordStepDeps<
        ReactElement
      >['RateLimitCard'],
      authHiddenFields,
    },
  )

export default LoginPasswordStep
