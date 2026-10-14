/** Props {@linkcode createPhoneConfirmView}'s returned view expects — the exact shape `iam`'s own
 * `PhoneConfirmPage.loader` (`space/routes/[lang]/phone/confirm/page.tsx`) resolves. */
export type PhoneConfirmViewProps = {
  lang: string
  /** The phone number `../enroll/page.tsx`'s own `action` just dispatched an SMS code to — carried
   * through as a hidden field, since the server never persisted it. */
  phone: string
  csrfToken?: string
  fieldErrors?: Record<string, { constraints?: string[] }[]>
  invalidCode: boolean
}
