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
 * // Enrollment (requires an authenticated session). Changing the second factor needs a
 * // `factor-change` step-up token (`StepUpClient`), bound to `totp-confirm`:
 * const { secret, uri } = await totp.enroll(accessToken) // render `uri` as a QR code
 * await totp.confirmEnrollment(accessToken, secret, '123456', stepUpToken)
 *
 * // Login verification (no session yet — TOTP itself is the second factor):
 * const { accessToken: newAccessToken } = await totp.verifyLogin('user@example.com', '123456')
 *
 * // Disabling (requires an authenticated session and a step-up token bound to `totp-disable`):
 * await totp.disable(accessToken, stepUpToken)
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
   * Confirms a TOTP enrollment by verifying `code` against the secret {@link enroll} issued, then
   * persists it and enables TOTP as the account's 2FA method on login. Requires an authenticated
   * session and a `factor-change` step-up token bound to `totp-confirm`.
   *
   * @param secret The secret {@link enroll} returned. `iam` confirms the secret it issued and
   * refuses a different one, so this only has to match.
   * @param stepUpToken The step-up token (purpose `factor-change`, bind `totp-confirm`).
   * @throws {RestClientError} `realHttpStatus === 403` when `code` doesn't match, the secret is not
   * the issued one, or the step-up token is missing, invalid or already used (`code`
   * `FACTOR_CHANGE_PROOF_REQUIRED` / `FACTOR_CHANGE_PROOF_INVALID`); `400` when no enrollment is
   * pending.
   */
  public confirmEnrollment(
    accessToken: string,
    secret: string,
    code: string,
    stepUpToken?: string,
  ): Promise<MessageResponse> {
    const body = new TotpConfirmRTO()
    body.secret = secret
    body.code = code
    return this.http.post<MessageResponse>('login/totp/confirm', {
      body: JSON.stringify(body),
      headers: this.factorChangeHeaders(accessToken, stepUpToken),
    })
  }

  /** Disables TOTP 2FA for the caller's own account. A no-op (not an error) if it wasn't enabled
   * in the first place. Requires an authenticated access token and a `factor-change` step-up token
   * bound to `totp-disable`. */
  public disable(accessToken: string, stepUpToken?: string): Promise<MessageResponse> {
    return this.http.delete<MessageResponse>('login/totp', {
      headers: this.factorChangeHeaders(accessToken, stepUpToken),
    })
  }
}
