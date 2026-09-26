import type { MessageResponse } from '../rtos/common.ts'

import { IamApiClient } from './base.ts'

/**
 * Thin REST client over `iam`'s real `UsersController` — the two self-scoped account-lifecycle
 * mutations it exposes. See `docs/consuming-iam.md`/`LoginClient` for how a deactivated account
 * comes back (an OTP or OAuth2 login plus an explicit reactivation confirmation — a deleted
 * account never comes back through any login).
 */
export class UsersClient extends IamApiClient {
  /**
   * Deactivates the CALLER's own account. Self-scoped — the target account is always the
   * session's own subject, resolved server-side from `accessToken`; there is no way to pass a
   * different account's id. Reversible, but never silently: a later successful OTP or OAuth2 login
   * (`OtpClient.verify`/`LoginClient.oauthCallback`) returns `{ needsReactivationConfirm,
   * reactivationToken }` instead of tokens, and only `LoginClient.confirmReactivation`
   * (`POST /login/reactivate`) with that token reactivates the account and finishes login.
   */
  public deactivateOwnAccount(accessToken: string): Promise<MessageResponse> {
    return this.http.patch<MessageResponse>('users/deactivate', {
      headers: this.authHeaders(accessToken),
    })
  }

  /**
   * Deletes the CALLER's own account. Self-scoped, same guarantee as {@link deactivateOwnAccount}.
   * Not reversible through any login flow.
   */
  public deleteOwnAccount(accessToken: string): Promise<MessageResponse> {
    return this.http.delete<MessageResponse>('users', { headers: this.authHeaders(accessToken) })
  }
}
