import { h } from 'preact'
import type { VNode } from 'preact'
import { Button, Field, Input, useIntl } from '@zanix/space-ui/preact'
// A NAMED import — see `index.ts`'s own identical doc.
import { ManagedForm } from '@zanix/space/comet/preact'
// These are this project's own Comets — see `index.ts`'s own identical doc.
import PasswordToggleField from 'ui/components/password-toggle-field/index.preact.ts'
import { RateLimitCard } from 'ui/components/rate-limit-card/index.preact.ts'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createLoginView } from './render.ts'
import type { LoginViewDeps } from './render.ts'
import type { LoginViewProps } from './types.ts'

export type { LoginViewProps }

/**
 * `iam`'s password-login view — see `index.ts`'s own doc for the full description. Preact
 * binding, same props, same rendered markup; import from `@zanix/iam/ui/pages/login` for the
 * React one.
 */
// Same overload-set cast, and same `ManagedForm`/`PasswordToggleField` casts, `index.ts`'s own
// React binding uses — see that file's own doc for both.
export const LoginView: (props: LoginViewProps) => VNode = createLoginView<VNode>(
  h as unknown as CreateElement<VNode>,
  {
    useIntl,
    Button,
    Field,
    Input,
    PasswordToggleField: PasswordToggleField as unknown as LoginViewDeps<
      VNode
    >['PasswordToggleField'],
    RateLimitCard: RateLimitCard as unknown as LoginViewDeps<VNode>['RateLimitCard'],
    ManagedForm: ManagedForm as unknown as LoginViewDeps<VNode>['ManagedForm'],
  },
)
