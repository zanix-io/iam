import type { MessageResponse } from '../rtos/common.ts'
import type { SecondFactorLoginResult, TotpEnrollResult } from '../rtos/login.ts'

import { IamApiClient } from './base.ts'
import { TotpLoginRTO } from '../rtos/login.ts'
import { TotpConfirmRTO } from '../rtos/password.ts'

/**
 * Thin REST client over `iam`'s real authenticator-app (TOTP) endpoints: login verification
 * (`POST /login/totp/callback`), enrollment (`GET /login/totp/enroll`,
 * `POST /login/totp/confirm`), and disabling (`DELETE /login/totp`) — distinct from `OtpClient`'s
 * out-of-band codes.
 *
 * @example
 * ```ts
 * const totp = new TotpClient({ baseUrl: 'https://iam.example.com/api' })
 *
 * // Enrollment (requires an authenticated session):
 * const { secret, uri } = await totp.enroll(accessToken) // render `uri` as a QR code
 * await totp.confirmEnrollment(accessToken, secret, '123456')
 *
 * // Login verification (no session yet — TOTP itself is the second factor):
 * const { accessToken: newAccessToken } = await totp.verifyLogin('user@example.com', '123456')
 *
 * // Disabling (requires an authenticated session):
 * await totp.disable(accessToken)
 * ```
 */
export class TotpClient extends IamApiClient {
  /**
   * Verifies the authenticator-app `code` for `email`'s TOTP-secured login and, on success,
   * issues session tokens.
   *
   * @throws {RestClientError} `realHttpStatus === 403` when the account has no TOTP secret
   * enrolled, or `code` doesn't match.
   */
  public verifyLogin(email: string, code: string): Promise<SecondFactorLoginResult> {
    const body = new TotpLoginRTO()
    body.email = email
    body.code = code
    return this.http.post<SecondFactorLoginResult>('login/totp/callback', {
      body: JSON.stringify(body),
    })
  }

  /**
   * Begins TOTP enrollment for the caller's own account — returns a secret and its
   * QR-provisioning URI, not yet persisted. Confirm with {@link confirmEnrollment} before the
   * secret is actually stored. Requires an authenticated session.
   */
  public enroll(accessToken: string): Promise<TotpEnrollResult> {
    return this.http.get<TotpEnrollResult>('login/totp/enroll', {
      headers: this.authHeaders(accessToken),
    })
  }

  /**
   * Confirms a TOTP enrollment by verifying `code` against the just-generated `secret`, then
   * persists it and enables TOTP as the account's 2FA method on login. Requires an authenticated
   * session.
   *
   * @throws {RestClientError} `realHttpStatus === 403` when `code` doesn't match `secret`.
   */
  public confirmEnrollment(
    accessToken: string,
    secret: string,
    code: string,
  ): Promise<MessageResponse> {
    const body = new TotpConfirmRTO()
    body.secret = secret
    body.code = code
    return this.http.post<MessageResponse>('login/totp/confirm', {
      body: JSON.stringify(body),
      headers: this.authHeaders(accessToken),
    })
  }

  /** Disables TOTP 2FA for the caller's own account. A no-op (not an error) if it wasn't enabled
   * in the first place. Requires an authenticated access token. */
  public disable(accessToken: string): Promise<MessageResponse> {
    return this.http.delete<MessageResponse>('login/totp', {
      headers: this.authHeaders(accessToken),
    })
  }
}
