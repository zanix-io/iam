/**
 * @module
 *
 * Response shapes of `iam`'s service endpoints for the authenticator app of an account
 * (`POST /admin/service/accounts/lookup`).
 */

/** `POST /admin/service/accounts/lookup`'s real response: what a reset needs to know, never the
 * email, hashes or secrets. */
export interface ServiceAccountLookup {
  /** The `auth` id of the account, the id a reset addresses it by. */
  authId: string
  /** The id of the person's profile. */
  userId: string
  /** The profile status: `ACTIVE` or `INACTIVE` (a `DELETED` person is not found). */
  status: string
  /** Whether the account has an authenticator app (a reset has something to remove). */
  hasTotp: boolean
  /** How many unused backup codes the account holds. */
  backupCodesRemaining: number
}
