/** Props {@linkcode createOauthCallbackView}'s returned view expects. */
export type OauthCallbackViewProps = {
  /** Where the `<meta http-equiv="refresh">`/fallback `<a>` sends the visitor next — `'/'` when
   * omitted (a completed login). The owning page's `loader` passes another step when
   * `AuthService.loginWithOauthCallback` did not finish the login: `/${lang}/login/reactivate/:token`
   * for a reactivation challenge, `/${lang}/login/totp/:email` or `/${lang}/login/otp/:email` for a
   * second-factor challenge. */
  redirectTo?: string
}
