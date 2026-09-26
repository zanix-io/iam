import { createElement } from 'react'
import type { ReactElement } from 'react'
import { Button, Field, Input, useIntl } from '@zanix/space-ui'
// A NAMED import — `@zanix/space/comet/react` carries more than one ready-made Comet, so there is
// no single default. `ManagedForm` composes `FormDraftPersistence`/`SubmitGuard`/
// `UnsavedChangesGuard` under one `formId` — this view enables the first two (see
// `render.ts`'s own `DRAFT_STORAGE_KEY` doc for why draft persistence is worth it here), never
// `unsavedChanges`.
import { ManagedForm } from '@zanix/space/comet/react'
// These are this project's own Comets (not shipped by `@zanix/space`) — see each one's own
// `render.ts` doc for why it needed one.
import PasswordToggleField from 'ui/components/password-toggle-field/index.ts'
import { RateLimitCard } from 'ui/components/rate-limit-card/index.ts'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createLoginView } from './render.ts'
import type { LoginViewDeps } from './render.ts'
import type { LoginViewProps } from './types.ts'

export type { LoginViewProps }

/**
 * `iam`'s password-login view — a heading, an invalid-credentials banner, an email/password form
 * (draft-recovering, double-submit-guarded), an optional Terms link, and the list of configured
 * OAuth2 "Continue with..." links.
 *
 * React binding — import from `@zanix/iam/ui/pages/login/preact` for the Preact one. Assign this
 * directly as a `SpacePageController` subclass's `component` field; the loader/action logic that
 * resolves {@linkcode LoginViewProps} stays in the owning `@zanix/space` page.
 */
// Same overload-set cast `@zanix/space-ui`'s own component bindings use — `React.createElement`'s
// overload set has no single member matching `CreateElement<E>`'s general shape, only the call
// sites in `render.ts` (a plain string tag with a plain props object) actually exercised here.
// `ManagedForm` is cast the same way: `@zanix/space`'s own `CometBoundaryComponent` return type
// (`SpaceChildren`, a renderer-neutral union) is a real supertype of `ReactElement | null`, not a
// structural match `LoginViewDeps` can express without narrowing — safe here since `ManagedForm`
// always renders `null` in practice (see `@zanix/space`'s own doc). `PasswordToggleField` is the
// same `CometBoundaryComponent` shape, cast the same way — it never renders `null` in practice
// (unlike `ManagedForm`, it renders real, visible markup), but the structural mismatch is identical.
export const LoginView: (props: LoginViewProps) => ReactElement = createLoginView<ReactElement>(
  createElement as unknown as CreateElement<ReactElement>,
  {
    useIntl,
    Button,
    Field,
    Input,
    PasswordToggleField: PasswordToggleField as unknown as LoginViewDeps<
      ReactElement
    >['PasswordToggleField'],
    RateLimitCard: RateLimitCard as unknown as LoginViewDeps<
      ReactElement
    >['RateLimitCard'],
    ManagedForm: ManagedForm as unknown as LoginViewDeps<ReactElement>['ManagedForm'],
  },
)
