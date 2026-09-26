/** Props for `authHiddenFields` — the `_csrf` hidden field plus at most one subject field. */
export type AuthHiddenFieldsProps = {
  /** The CSRF token issued for this `GET` — mirrors every other form's own `_csrf` hidden field.
   * Coerced to `''` when absent. */
  csrfToken?: string
  /** The email this form's own `action` derives its real subject from via the route's own URL
   * param — carried in the body too because `OtpLoginRTO`/`TotpLoginRTO` (`ui/sdk/otp.ts`/
   * `ui/sdk/totp.ts`'s own REST callback body schema, reused verbatim as these SSR pages' own
   * `@Page({ action: { Body } })` validation schema) requires it, even though neither page's own
   * `action` ever reads `body.email` — see `render.ts`'s own doc. Omit entirely for a form keyed by a different subject (see `phone` below). */
  email?: string
  /** Same shape/reasoning as `email` above, for a form whose own body schema carries a phone
   * number instead (an app's own profile form posting straight to `zanix/iam`'s `phone/enroll`
   * route) — never both at once in practice, but nothing here enforces
   * that; a caller passes whichever single subject its own form's `Body` RTO actually requires. */
  phone?: string
}
