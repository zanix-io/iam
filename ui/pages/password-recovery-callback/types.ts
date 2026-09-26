/** Props {@linkcode createRecoveryCallbackView}'s returned view expects — the exact shape `iam`'s
 * own `PasswordRecoveryCallbackPage.loader`
 * (`space/routes/[lang]/password/recovery/callback/page.tsx`) resolves. */
export type RecoveryCallbackViewProps = {
  csrfToken?: string
  fieldErrors?: Record<string, unknown>
  submitted?: Record<string, string>
  invalidCode: boolean
  /** True when the owning page's own `action` rejected the submission because `password` and
   * `confirmPassword` didn't match — checked entirely on the consuming app's own side, same as
   * `security/add-password/page.tsx`'s own `AddPasswordFormRTO`; never sent to `iam`'s real
   * `POST /pwd/recovery/callback` endpoint, which only ever receives the one `password` value. */
  mismatch: boolean
  /** True when `iam` rejected the new password under its active password policy
   * (`POST /pwd/recovery/callback` answering `400`). Optional; omitted renders no banner. */
  weakPassword?: boolean
  /** Pre-fills the email field when known — see {@link emailLocked} for when it's also `readOnly`. */
  email: string
  /** True whenever the owning page already has a real `email` for this request, from ANY source
   * (an authenticated session's own known address, a value carried through a prior step's own
   * redirect, a link from `../password-recovery-request/index.ts`'s own confirmation view, ...).
   * By the time any of those can hand this view a non-empty `email`, a real recovery code was
   * ALREADY dispatched to that exact address — retyping it here never re-dispatches anything to
   * the new value, so leaving the field editable would just be misleading, not a genuine
   * "fix a typo" affordance. Locking it (`readOnly`, not `disabled` — the value must still submit)
   * closes that gap. Only truly falls back to editable when `email` itself is empty — a visitor
   * with a code from some out-of-band channel, who never went through this view's own dispatch
   * flow at all, has nothing here to lock TO. */
  emailLocked: boolean
  /** This request's own CSP nonce (`ctx.cspNonce`, `@zanix/space`'s `PageContext`) — forwarded to
   * `PasswordToggleField`'s own `nonce` prop (its default eye/eye-off icon strokes need it — see
   * `login/types.ts`'s own identical doc). Optional: a consumer that hasn't
   * wired this prop through yet still renders, just without that nonce, which a strict CSP would
   * then block. */
  nonce?: string
}
