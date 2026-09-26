import { h } from 'preact'
import type { VNode } from 'preact'
import { Button, Field, Link } from '@zanix/space-ui/preact'
// These are this project's own Comets and helpers — see `login/index.ts`'s own doc.
import PasswordToggleField from 'ui/components/password-toggle-field/index.preact.ts'
import { RateLimitCard } from 'ui/components/rate-limit-card/index.preact.ts'
import { authHiddenFields } from 'ui/components/auth-hidden-fields/index.preact.ts'
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
export const LoginPasswordStep: (props: LoginPasswordStepProps) => VNode = createLoginPasswordStep<
  VNode
>(
  h as unknown as CreateElement<VNode>,
  {
    Button: Button as unknown as LoginPasswordStepDeps<VNode>['Button'],
    Field: Field as unknown as LoginPasswordStepDeps<VNode>['Field'],
    Link: Link as unknown as LoginPasswordStepDeps<VNode>['Link'],
    PasswordToggleField: PasswordToggleField as unknown as LoginPasswordStepDeps<
      VNode
    >['PasswordToggleField'],
    RateLimitCard: RateLimitCard as unknown as LoginPasswordStepDeps<VNode>['RateLimitCard'],
    authHiddenFields,
  },
)

export default LoginPasswordStep
