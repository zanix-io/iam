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
 * // Verification (requires an authenticated session). Confirming, changing the channel and
 * // forgetting the number each need a `factor-change` step-up token (`StepUpClient`) bound to
 * // `phone-confirm`, `otp-notifier` and `phone-disable` respectively:
 * await phone.enroll(accessToken, '+15551234567')
 * await phone.confirm(accessToken, '+15551234567', '123456', stepUpToken)
 *
 * // Choosing where login codes arrive, once verified:
 * await phone.setOtpNotifier(accessToken, 'sms', stepUpToken)
 * await phone.setOtpNotifier(accessToken, undefined, stepUpToken) // back to email
 *
 * // Forgetting the number entirely:
 * await phone.disable(accessToken, stepUpToken)
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
   * persists `phone` on the caller's own account. Requires an authenticated session and a
   * `factor-change` step-up token bound to `phone-confirm`.
   *
   * @throws {RestClientError} `realHttpStatus === 403` when `code` doesn't verify or the step-up
   * token is missing, invalid or already used.
   */
  public confirm(
    accessToken: string,
    phone: string,
    code: string,
    stepUpToken?: string,
  ): Promise<MessageResponse> {
    const body = new PhoneConfirmRTO()
    body.phone = phone
    body.code = code
    return this.http.post<MessageResponse>('login/phone/confirm', {
      body: JSON.stringify(body),
      headers: this.factorChangeHeaders(accessToken, stepUpToken),
    })
  }

  /** Forgets the caller's own verified phone (and any `'sms'`/`'whatsapp'` login-OTP preference
   * that depended on it). Requires an authenticated session and a `factor-change` step-up token
   * bound to `phone-disable`. */
  public disable(accessToken: string, stepUpToken?: string): Promise<MessageResponse> {
    return this.http.delete<MessageResponse>('login/phone', {
      headers: this.factorChangeHeaders(accessToken, stepUpToken),
    })
  }

  /**
   * Sets (or, `notifier` omitted/`''`, clears back to `'email'`) which channel the caller's own
   * passwordless login-OTP code is delivered through. Requires an authenticated session and a
   * `factor-change` step-up token bound to `otp-notifier`.
   *
   * @throws {RestClientError} `realHttpStatus === 400` when `notifier` is `'sms'`/`'whatsapp'` and
   * the account has no verified phone on file yet — call {@link enroll}/{@link confirm} first.
   */
  public setOtpNotifier(
    accessToken: string,
    notifier?: 'sms' | 'whatsapp' | '',
    stepUpToken?: string,
  ): Promise<MessageResponse> {
    const body = new OtpNotifierRTO()
    if (notifier) body.notifier = notifier
    return this.http.post<MessageResponse>('login/otp-notifier', {
      body: JSON.stringify(body),
      headers: this.factorChangeHeaders(accessToken, stepUpToken),
    })
  }
}
