import type { StepUpRequestResult, StepUpVerifyResult } from '../rtos/step-up.ts'

import { IamApiClient } from './base.ts'
import { StepUpRequestRTO, StepUpVerifyRTO } from '../rtos/step-up.ts'

/**
 * Thin REST client over `iam`'s step-up endpoints (`POST /step-up/request`,
 * `POST /step-up/verify`): the second factor of an already signed-in user, ahead of a sensitive
 * action. The factor is the one the user's own settings give (their authenticator app when TOTP is
 * enabled, a one-time code through their notifier otherwise); the caller cannot choose another.
 *
 * @example
 * ```ts
 * const stepUp = new StepUpClient({ baseUrl: 'https://iam.example.com/api' })
 *
 * const { method, channel } = await stepUp.request(accessToken, 'wallet-transfer')
 * // method 'totp': ask for the authenticator code; 'otp': a code was sent through `channel`.
 * const { stepUpToken } = await stepUp.verify(accessToken, 'wallet-transfer', '123456', 'tx-42')
 * // send `stepUpToken` to the service that performs the action
 * ```
 */
export class StepUpClient extends IamApiClient {
  /**
   * Starts a step-up for `purpose` (1 to 64 lowercase letters, digits and hyphens). Requires an
   * authenticated session.
   *
   * @throws {RestClientError} `realHttpStatus === 401` without a valid access token; `429` when
   * called again within the rate-limit window; `400` for an invalid `purpose` or a notifier with
   * no destination on file.
   */
  public request(accessToken: string, purpose: string): Promise<StepUpRequestResult> {
    const body = new StepUpRequestRTO()
    body.purpose = purpose
    return this.http.post<StepUpRequestResult>('step-up/request', {
      body: JSON.stringify(body),
      headers: this.authHeaders(accessToken),
    })
  }

  /**
   * Verifies `code` and answers a step-up token for `purpose`, bound to `bind` when given.
   * Requires an authenticated session.
   *
   * @throws {RestClientError} `realHttpStatus === 403`, always with the same message, when the code
   * is wrong, expired, never issued or issued for another purpose; `401` without a valid access
   * token; `429` after too many attempts in the rate-limit window.
   */
  public verify(
    accessToken: string,
    purpose: string,
    code: string,
    bind?: string,
  ): Promise<StepUpVerifyResult> {
    const body = new StepUpVerifyRTO()
    body.purpose = purpose
    body.code = code
    body.bind = bind
    return this.http.post<StepUpVerifyResult>('step-up/verify', {
      body: JSON.stringify(body),
      headers: this.authHeaders(accessToken),
    })
  }
}
