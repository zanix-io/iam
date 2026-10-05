import type { CountdownAnnouncementProps } from '../../sdk/countdown-announcements.ts'

/** Already-resolved copy of the password step. Never a message key: the app resolves its own
 * wording (and languages) and passes plain strings, the same contract `RateLimitCard` has. The
 * countdown's three screen-reader texts (`announcement*`) are optional and fall back to English. */
export type LoginPasswordStepLabels = CountdownAnnouncementProps & {
  /** The step's heading. */
  heading: string
  /** The line before the email, e.g. "Signing in as". */
  signingInAs: string
  /** The password was rejected. */
  invalidPassword: string
  /** A rate limit with no live countdown to show. */
  rateLimited: string
  /** The rate-limit card's heading and lead-in line, shown with a live countdown. */
  rateLimitedHeading: string
  rateLimitedBody: string
  /** Any other failure of the sign-in call. */
  unexpectedError: string
  passwordLabel: string
  showPassword: string
  hidePassword: string
  submit: string
  /** The button that sends a password-recovery code; omitting it, like `recoveryAction: false`, leaves the form out. */
  forgotPassword?: string
  /** The link back to the email step. */
  useAnotherEmail: string
}

/** Styling and wiring the app may change; every field has a default. */
export type LoginPasswordStepOptions = {
  /** `class` of the heading. Unset renders none. */
  headingClassName?: string
  /** `class` of the sign-in button. @default 'btn btn-primary btn-block' */
  submitClassName?: string
  /** `class` of the "forgot password" button. @default 'btn-text' */
  linkButtonClassName?: string
  /** The sign-in `<form>` id, the rate-limit card's re-enable target. @default 'login-password-form' */
  formId?: string
  /** The rate-limit card's root `data-space`. @default 'login-password-rate-limit' */
  cardDataSpace?: string
  /** Where "forgot password" posts; `false` omits the button, for an app with no recovery page.
   * @default `/${lang}/login/password/recovery` */
  recoveryAction?: string | false
  /** Where "use another email" goes. @default `/${lang}/login` */
  loginHref?: string
}

/** Props of the password step of a two-step sign-in: the field shown once the account is known to
 * have a password. */
export type LoginPasswordStepProps = {
  lang: string
  /** The email the step is for. */
  email: string
  /** The step is the one to show; otherwise it is rendered `hidden` for a comet to reveal. */
  passwordStep: boolean
  csrfToken?: string
  invalidPassword: boolean
  rateLimited: boolean
  unexpectedError: boolean
  /** The instant (epoch ms) the rate limit clears; a past or missing value shows no countdown. */
  retryUntil?: number
  clearQueryParamsOnRateLimitComplete?: string[]
  nonce?: string
  labels: LoginPasswordStepLabels
  options?: LoginPasswordStepOptions
}
