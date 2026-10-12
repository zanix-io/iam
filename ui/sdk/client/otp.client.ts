import type { MessageResponse } from '../rtos/common.ts'
import type { OtpCallbackResult } from '../rtos/login.ts'
import type { NOTIFIERS } from 'utils/shared-enums.ts'

import { IamApiClient } from './base.ts'
import { OtpLoginRTO } from '../rtos/login.ts'

/**
 * Thin REST client over `iam`'s real OTP-login endpoints (`GET /login/otp/:email`,
 * `POST /login/otp/callback`) — a login/second-factor code delivered out of band (email/SMS/
 * WhatsApp, chosen server-side), distinct from `TotpClient`'s authenticator-app codes.
 *
 * @example
 * ```ts
 * const otp = new OtpClient({ baseUrl: 'https://iam.example.com/api' })
 * await otp.request('user@example.com')
 * // ...user enters the code they received...
 * const { accessToken, refreshToken } = await otp.verify('user@example.com', '123456')
 * ```
 */
export class OtpClient extends IamApiClient {
  /**
   * Requests an OTP code for `email`, delivered out of band. Complete with {@link verify}.
   *
   * @param notifier Overrides the account's own stored `otpNotifier` preference for THIS one
   * dispatch only — e.g. a resend retried through a different channel because the configured one
   * never arrived. Omitted, dispatch uses the account's stored preference.
   * @param lang The language of the code message (a BCP 47 tag such as `es`). Omitted, `iam` uses the
   * request's `Accept-Language`.
   * @throws {RestClientError} `realHttpStatus === 403` when no account exists for `email`.
   */
  public request(
    email: string,
    notifier?: typeof NOTIFIERS[number],
    lang?: string,
  ): Promise<MessageResponse> {
    const query = (notifier ? `?notifier=${encodeURIComponent(notifier)}` : '') +
      this.langQuery(lang, notifier ? '&' : '?')
    return this.http.get<MessageResponse>(`login/otp/${encodeURIComponent(email)}${query}`)
  }

  /**
   * Verifies the OTP `code` sent to `email` and, on success, issues session tokens — or, when the
   * account was `'INACTIVE'`, a reactivation challenge instead, or, when the account ALSO has 2FA
   * configured, a second-factor challenge (see {@link OtpCallbackResult}'s own doc; narrow with
   * `'needsReactivationConfirm' in result` first, then `'accessToken' in result`).
   *
   * @param lang The language of the welcome message a first sign-in sends (a BCP 47 tag such as `es`).
   * @throws {RestClientError} `realHttpStatus === 403` when no account exists for `email`, or
   * `code` is invalid/expired.
   */
  public verify(email: string, code: string, lang?: string): Promise<OtpCallbackResult> {
    const body = new OtpLoginRTO()
    body.email = email
    body.code = code
    return this.http.post<OtpCallbackResult>(`login/otp/callback${this.langQuery(lang)}`, {
      body: JSON.stringify(body),
    })
  }
}
