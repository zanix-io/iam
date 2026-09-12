/** Props {@linkcode createOtpView}'s returned view expects — the exact shape `iam`'s own
 * `LoginOtpPage.loader` (`space/routes/[lang]/login/otp/[email]/page.tsx`) resolves. */
export type OtpViewProps = {
  lang: string
  email: string
  csrfToken?: string
  fieldErrors?: Record<string, unknown>
  invalidCode: boolean
}
