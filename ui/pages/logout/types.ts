/** Props {@linkcode createLogoutView}'s returned view accepts — this form has no field of its own,
 * only the confirm action, so both are purely about where the visitor can go INSTEAD. */
export type LogoutViewProps = {
  /** Renders a "Cancel"/"never mind" link back to wherever the visitor came from — omitted when a
   * Tier-2 host has nowhere obvious to send them back to (see `docs/consuming-iam.md`), the same
   * graceful-degradation contract `LoginViewProps.termsUrl`/`privacyUrl` already establish. */
  cancelUrl?: string
}
