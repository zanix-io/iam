import type { MessageResponse } from '../rtos/common.ts'
import type { SecondFactorLoginResult } from '../rtos/login.ts'

import { IamApiClient } from './base.ts'
import { OtpLoginRTO } from '../rtos/login.ts'

/**
 * Thin REST client over `iam`'s real OTP-login endpoints (`GET /login/otp/:email`,
 * `POST /login/otp/callback`) — a login/second-factor code delivered out of band (email/SMS/
 * WhatsApp, chosen server-side), distinct from `TotpClient`'s authenticator-app codes.
 *
 * @example
 * ```ts
 * const otp = new OtpClient({ baseUrl: 'https://iam.example.com' })
 * await otp.request('user@example.com')
 * // ...user enters the code they received...
 * const { accessToken, refreshToken } = await otp.verify('user@example.com', '123456')
 * ```
 */
export class OtpClient extends IamApiClient {
  /**
   * Requests an OTP code for `email`, delivered out of band. Complete with {@link verify}.
   *
   * @throws {RestClientError} `realHttpStatus === 403` when no account exists for `email`.
   */
  public request(email: string): Promise<MessageResponse> {
    return this.http.get<MessageResponse>(`login/otp/${encodeURIComponent(email)}`)
  }

  /**
   * Verifies the OTP `code` sent to `email` and, on success, issues session tokens.
   *
   * @throws {RestClientError} `realHttpStatus === 403` when no account exists for `email`, or
   * `code` is invalid/expired.
   */
  public verify(email: string, code: string): Promise<SecondFactorLoginResult> {
    const body = new OtpLoginRTO()
    body.email = email
    body.code = code
    return this.http.post<SecondFactorLoginResult>('login/otp/callback', {
      body: JSON.stringify(body),
    })
  }
}
