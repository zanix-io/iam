/** Props {@linkcode createReactivateConfirmView}'s returned view expects — the exact shape `iam`'s
 * own `LoginReactivatePage.loader` (`space/routes/[lang]/login/reactivate/[token]/page.tsx`)
 * resolves. No `email`/`token` field here: unlike `login-otp`/`login-totp`, this view's own
 * `<form>` never needs to carry either back to `action` — the owning page's own `[token]` URL
 * param is the one and only identifier `action` reads. */
export type ReactivateConfirmViewProps = {
  lang: string
  csrfToken?: string
  /** `true` when the owning page's own `action` caught `zanix/iam`'s real
   * `POST /login/reactivate` rejecting with `403` — the token is invalid, expired, or was minted
   * for something else. Renders the error banner and a link back to `/login` instead of the
   * confirm form (a stale/reused link has nothing left to confirm). */
  expired: boolean
}
