/** Props {@linkcode createOtpView}'s returned view expects — the exact shape `iam`'s own
 * `LoginOtpPage.loader` (`space/routes/[lang]/login/otp/[email]/page.tsx`) resolves. */
export type OtpViewProps = {
  lang: string
  email: string
  csrfToken?: string
  fieldErrors?: Record<string, unknown>
  invalidCode: boolean
  /** Absolute epoch-ms instant a resend becomes available again — forwarded straight through to
   * the composed `OtpResend` (`ui/components/otp-resend`). Omitted means "no cooldown tracked",
   * the same as that component's own `cooldownEndsAt` contract — a resend is offered immediately. */
  cooldownEndsAt?: number
  /** This request's own CSP nonce — forwarded to `OtpResend`'s own live cooldown countdown. */
  nonce?: string
  /** The channel the code JUST DISPATCHED to this screen actually used — `null` means `'email'`,
   * the same `LoginMethodsResult.otpNotifier` convention (`AuthService.resolveLoginMethods`'s own
   * doc). Together with `hasVerifiedPhone`, decides which alternate-channel options (if any)
   * `OtpResend`'s own picker offers. */
  otpNotifier?: 'sms' | 'whatsapp' | null
  /** Whether an alternate delivery channel is even deliverable for this account at all — `false`
   * (or omitted) hides the alternate-channel picker entirely, same as `OtpResend`'s own
   * `alternateNotifiers: []` default. */
  hasVerifiedPhone?: boolean
}
