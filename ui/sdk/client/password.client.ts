import type { MessageResponse } from '../rtos/common.ts'
import type { PasswordRecoveryResult } from '../rtos/password.ts'

import { IamApiClient } from './base.ts'
import { AddPasswordRTO, PwdRecoveryCbRTO, PwdRTO } from '../rtos/password.ts'

/**
 * Thin REST client over `iam`'s real `PasswordController` — self-service password change
 * (`POST /pwd/change`) and the forgot-password recovery flow (`GET /pwd/recovery/:email`,
 * `POST /pwd/recovery/callback`), matching that controller's own real endpoint grouping rather
 * than the flow name alone; exported as this SDK's `./sdk/password-recovery` subpath.
 *
 * @example
 * ```ts
 * const password = new PasswordClient({ baseUrl: 'https://iam.example.com/api' })
 *
 * // Forgot password:
 * await password.requestRecovery('user@example.com')
 * const { accessToken } = await password.confirmRecovery('user@example.com', '123456', 'newPass1')
 *
 * // Self-service change (requires an authenticated session):
 * await password.change(accessToken, 'oldPass1', 'newPass1')
 * ```
 */
export class PasswordClient extends IamApiClient {
  /**
   * Changes the caller's own password after verifying `currentPassword`. Requires an
   * authenticated session — the target account is always the session's own subject.
   *
   * @throws {RestClientError} `realHttpStatus === 403` when `currentPassword` doesn't match;
   * `400` when `newPassword` fails `iam`'s active password policy (validate client-side first
   * with `./sdk/validation`'s `validatePassword` to surface this before submitting).
   */
  public change(
    accessToken: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<MessageResponse> {
    const body = new PwdRTO()
    body.currentPassword = currentPassword
    body.newPassword = newPassword
    return this.http.post<MessageResponse>('pwd/change', {
      body: JSON.stringify(body),
      headers: this.authHeaders(accessToken),
    })
  }

  /**
   * Sets a first password for the caller's own account — only when it doesn't already have one.
   * Never asks for a current password, unlike {@link change}: there genuinely isn't one to prove
   * knowledge of yet. Requires an authenticated access token.
   *
   * @throws {RestClientError} `realHttpStatus === 409` when a password is already set — use
   * {@link change} instead; `400` when `newPassword` fails `iam`'s active password policy.
   */
  public addPassword(accessToken: string, newPassword: string): Promise<MessageResponse> {
    const body = new AddPasswordRTO()
    body.newPassword = newPassword
    return this.http.post<MessageResponse>('pwd/add', {
      body: JSON.stringify(body),
      headers: this.authHeaders(accessToken),
    })
  }

  /** Removes the caller's own password entirely. A no-op (not an error) if none was set. Requires
   * an authenticated access token. */
  public removePassword(accessToken: string): Promise<MessageResponse> {
    return this.http.delete<MessageResponse>('pwd/remove', {
      headers: this.authHeaders(accessToken),
    })
  }

  /**
   * Requests a password-recovery code for `email`, delivered out of band. Complete with
   * {@link confirmRecovery}. Always returns the same generic confirmation whether or not an
   * account exists for `email`, to avoid leaking account existence.
   */
  public requestRecovery(email: string): Promise<MessageResponse> {
    return this.http.get<MessageResponse>(`pwd/recovery/${encodeURIComponent(email)}`)
  }

  /**
   * Verifies the recovery `code` sent to `email` and sets `password`, issuing session tokens.
   *
   * @throws {RestClientError} `realHttpStatus === 403` when no account exists for `email`, or
   * `code` is invalid/expired.
   */
  public confirmRecovery(
    email: string,
    code: string,
    password: string,
  ): Promise<PasswordRecoveryResult> {
    const body = new PwdRecoveryCbRTO()
    body.email = email
    body.code = code
    body.password = password
    return this.http.post<PasswordRecoveryResult>('pwd/recovery/callback', {
      body: JSON.stringify(body),
    })
  }
}
