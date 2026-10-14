import type { TotpResetResult, TotpResetsPage } from '../rtos/totp-admin.ts'

import { IamApiClient } from './base.ts'
import { TotpResetRTO } from '../rtos/totp-admin.ts'

/**
 * Thin REST client over `iam`'s operator endpoints for the authenticator app of an account
 * (`POST /admin/totp/reset`, `GET /admin/totp/resets`). Every call needs the access token of an
 * operator account that holds the `totp-reset` permission (`<SERVICE_ID>:totp-reset`, or `*`); a
 * service credential is refused.
 *
 * @example
 * ```ts
 * const admin = new TotpAdminClient({ baseUrl: 'https://iam.example.com/api' })
 * await admin.resetTotp(operatorAccessToken, authId, 'Lost phone, identity checked by call')
 * const { docs } = await admin.listResets(operatorAccessToken, { page: 1, limit: 20 })
 * ```
 */
export class TotpAdminClient extends IamApiClient {
  /**
   * Removes the authenticator app and the backup codes of the account `authId`, and emails its
   * owner. The reason is recorded in the audit trail.
   *
   * @param reason Why, 1 to 200 characters once trimmed.
   * @throws {RestClientError} `realHttpStatus === 403` when the caller lacks `totp-reset`, is not
   * an account, or targets their own (`code` `TOTP_RESET_SELF`); `404` when the account does not
   * exist; `409` (`code` `TOTP_NOT_ENABLED`) when it has no authenticator app.
   */
  public resetTotp(
    accessToken: string,
    authId: string,
    reason: string,
  ): Promise<TotpResetResult> {
    const body = new TotpResetRTO()
    body.authId = authId
    body.reason = reason
    return this.http.post<TotpResetResult>('admin/totp/reset', {
      body: JSON.stringify(body),
      headers: this.authHeaders(accessToken),
    })
  }

  /** One page of the recorded resets, newest first; `authId` keeps the resets of one account. */
  public listResets(
    accessToken: string,
    options: { authId?: string; page?: number; limit?: number } = {},
  ): Promise<TotpResetsPage> {
    const query = new URLSearchParams()
    if (options.authId) query.set('authId', options.authId)
    if (options.page) query.set('page', String(options.page))
    if (options.limit) query.set('limit', String(options.limit))
    const search = query.toString()
    return this.http.get<TotpResetsPage>(`admin/totp/resets${search ? `?${search}` : ''}`, {
      headers: this.authHeaders(accessToken),
    })
  }
}
