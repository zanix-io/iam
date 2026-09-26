import type { MessageResponse } from '../rtos/common.ts'

import { IamApiClient } from './base.ts'
import { OtpNotifierRTO, PhoneConfirmRTO, PhoneEnrollRTO } from '../rtos/password.ts'

/**
 * Thin REST client over `iam`'s real phone-verification and login-OTP-preference endpoints:
 * enrollment (`POST /login/phone/enroll`, `POST /login/phone/confirm`), disabling
 * (`DELETE /login/phone`), and the delivery-channel preference itself (`POST /login/otp-notifier`)
 * — distinct from `OtpClient`'s own out-of-band login codes and `TotpClient`'s authenticator-app
 * flow: this never issues a session on its own, it only manages a verified phone number and where
 * a passwordless login code gets delivered.
 *
 * @example
 * ```ts
 * const phone = new PhoneClient({ baseUrl: 'https://iam.example.com/api' })
 *
 * // Verification (requires an authenticated session):
 * await phone.enroll(accessToken, '+15551234567')
 * await phone.confirm(accessToken, '+15551234567', '123456')
 *
 * // Choosing where login codes arrive, once verified:
 * await phone.setOtpNotifier(accessToken, 'sms')
 * await phone.setOtpNotifier(accessToken) // back to email
 *
 * // Forgetting the number entirely:
 * await phone.disable(accessToken)
 * ```
 */
export class PhoneClient extends IamApiClient {
  /**
   * Begins phone verification for the caller's own account — sends a one-time SMS code to
   * `phone`, not yet persisted. Confirm with {@link confirm} before the number is actually stored.
   * Requires an authenticated session.
   */
  public enroll(accessToken: string, phone: string): Promise<MessageResponse> {
    const body = new PhoneEnrollRTO()
    body.phone = phone
    return this.http.post<MessageResponse>('login/phone/enroll', {
      body: JSON.stringify(body),
      headers: this.authHeaders(accessToken),
    })
  }

  /**
   * Confirms phone verification by checking `code` against the just-dispatched SMS code, then
   * persists `phone` on the caller's own account. Requires an authenticated session.
   *
   * @throws {RestClientError} `realHttpStatus === 403` when `code` doesn't verify.
   */
  public confirm(accessToken: string, phone: string, code: string): Promise<MessageResponse> {
    const body = new PhoneConfirmRTO()
    body.phone = phone
    body.code = code
    return this.http.post<MessageResponse>('login/phone/confirm', {
      body: JSON.stringify(body),
      headers: this.authHeaders(accessToken),
    })
  }

  /** Forgets the caller's own verified phone (and any `'sms'`/`'whatsapp'` login-OTP preference
   * that depended on it). Requires an authenticated session. */
  public disable(accessToken: string): Promise<MessageResponse> {
    return this.http.delete<MessageResponse>('login/phone', {
      headers: this.authHeaders(accessToken),
    })
  }

  /**
   * Sets (or, `notifier` omitted/`''`, clears back to `'email'`) which channel the caller's own
   * passwordless login-OTP code is delivered through. Requires an authenticated session.
   *
   * @throws {RestClientError} `realHttpStatus === 400` when `notifier` is `'sms'`/`'whatsapp'` and
   * the account has no verified phone on file yet — call {@link enroll}/{@link confirm} first.
   */
  public setOtpNotifier(
    accessToken: string,
    notifier?: 'sms' | 'whatsapp' | '',
  ): Promise<MessageResponse> {
    const body = new OtpNotifierRTO()
    if (notifier) body.notifier = notifier
    return this.http.post<MessageResponse>('login/otp-notifier', {
      body: JSON.stringify(body),
      headers: this.authHeaders(accessToken),
    })
  }
}
