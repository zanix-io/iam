/** Props {@linkcode createPhoneEnrollView}'s returned view expects — the exact shape `iam`'s own
 * `PhoneEnrollPage.loader` (`space/routes/[lang]/phone/enroll/page.tsx`) resolves. */
export type PhoneEnrollViewProps = {
  lang: string
  csrfToken?: string
  /** Set only on the redirect `../confirm/page.tsx`'s own `action` sends back with, on a rejected
   * code — lets a caller retry from scratch (the OTP is already consumed/expired at that point). */
  invalidCode: boolean
  /** Already-resolved field-level validation error(s) for `phone` (a malformed number) — the same
   * shape `login-otp/render.ts`'s own `fieldErrors` carries. */
  fieldErrors?: Record<string, { constraints?: string[] }[]>
}
