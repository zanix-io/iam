import type { LoginViewProps } from 'ui/pages/login/types.ts'
import type { LoginPasswordStepOptions } from 'ui/components/login-password-step/types.ts'

/** The state of a two-step sign-in page: `LoginView`'s own props plus the password step. */
export type LoginEntryData = LoginViewProps & {
  /** The password step is the one to show (`?step=password`). */
  passwordStep: boolean
  /** The email the password step is for, `''` when none. */
  stepEmail: string
  /** The password step's password was rejected. */
  invalidPassword: boolean
}

/** Props of `LoginEntryView`: the page state, and what the host app decides about presentation. */
export type LoginEntryViewProps<E = unknown> = LoginEntryData & {
  /** The frame around both steps: the app's own card or page chrome. It receives the steps as
   * `children`. @default a plain `<div>` */
  Card?: (props: { children: E | E[] }) => E
  /** `class` of the password step's heading. */
  headingClassName?: string
  /** Where "forgot password" posts, or `false` when the app has no recovery page.
   * @see LoginPasswordStepOptions.recoveryAction */
  recoveryAction?: LoginPasswordStepOptions['recoveryAction']
}
