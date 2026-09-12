/** Props {@linkcode createRecoveryCallbackView}'s returned view expects — the exact shape `iam`'s
 * own `PasswordRecoveryCallbackPage.loader`
 * (`space/routes/[lang]/password/recovery/callback/page.tsx`) resolves. */
export type RecoveryCallbackViewProps = {
  csrfToken?: string
  fieldErrors?: Record<string, unknown>
  submitted?: Record<string, string>
  invalidCode: boolean
  /** Pre-fills the email field when reached via `../password-recovery-request/index.ts`'s own
   * `?email=` link — still a plain, editable text input, since a code can arrive out of band (e.g.
   * a bookmarked link, or a code copied from an email opened on another device). */
  email: string
}
