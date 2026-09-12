/** Props {@linkcode createTotpLoginView}'s returned view expects — the exact shape `iam`'s own
 * `LoginTotpPage.loader` (`space/routes/[lang]/login/totp/[email]/page.tsx`) resolves. */
export type TotpViewProps = {
  lang: string
  email: string
  csrfToken?: string
  fieldErrors?: Record<string, unknown>
  invalidCode: boolean
}
