/** Props {@linkcode createTotpEnrollView}'s returned view expects — the exact shape `iam`'s own
 * `TotpEnrollPage.loader` (`space/routes/[lang]/totp/enroll/page.tsx`) resolves. */
export type TotpEnrollViewProps = {
  lang: string
  secret: string
  uri: string
  qrCodeSvg: string
  csrfToken?: string
  invalidCode: boolean
}
