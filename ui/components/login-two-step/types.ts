/** Props of `LoginTwoStep`, the headless Comet that turns an email-then-password sign-in into a
 * two-step flow without a page reload. */
export type LoginTwoStepProps = {
  lang: string
  csrfToken?: string
  /** The email step's `<form>` id, the one whose submit is intercepted. @default 'login-form' */
  formId?: string
  /** The endpoint that answers `{ email }` with `{ hasPassword }`. @default `/${lang}/login/methods` */
  methodsHref?: string
}
