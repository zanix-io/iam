/** Props {@linkcode createPhoneConfirmView}'s returned view expects — the exact shape `iam`'s own
 * `PhoneConfirmPage.loader` (`space/routes/[lang]/phone/confirm/page.tsx`) resolves. */
export type PhoneConfirmViewProps = {
  lang: string
  /** The phone number `../enroll/page.tsx`'s own `action` just dispatched an SMS code to — carried
   * through as a hidden field, same "round-trip an enrollment-in-progress value the server never
   * persisted yet" shape `totp-enroll/render.ts`'s own `secret` hidden field already establishes. */
  phone: string
  csrfToken?: string
  fieldErrors?: Record<string, { constraints?: string[] }[]>
  invalidCode: boolean
}
