import type { TotpResetResult, TotpResetsPage } from '../rtos/totp-admin.ts'
import type { ServiceAccountLookup } from '../rtos/totp-service.ts'

import { IamApiClient, type IamApiClientOptions } from './base.ts'

/** What a {@linkcode TotpServiceClient} needs beyond the base URL. */
export interface TotpServiceClientOptions extends IamApiClientOptions {
  /**
   * Answers the headers that authenticate this service on `iam`: `{ 'X-Znx-Authorization':
   * 'Bearer <token>' }`, with a token minted by exchanging the service's signed assertion at the
   * `exchangeUrl` it is given. `@zanix/auth`'s `createServiceAuthClient` is exactly this, cached:
   *
   * ```ts
   * const auth = createServiceAuthClient({ serviceId: 'ops-console' })
   * new TotpServiceClient({ baseUrl, serviceAuth: (url) => auth('zanix-iam', url) })
   * ```
   */
  serviceAuth: (exchangeUrl: string) => Promise<Record<string, string>>
}

/**
 * Thin REST client over `iam`'s service endpoints for the authenticator app of an account
 * (`/admin/service/*`): a trusted service looks an account up by its exact email and resets its
 * authenticator app on behalf of an operator it authenticated itself. The service authenticates
 * with its own credential, never with a user token; `iam` serves only the services named in
 * `IAM_TOTP_RESET_SERVICES` and refuses everyone while it is unset.
 *
 * @example
 * ```ts
 * const client = new TotpServiceClient({ baseUrl: 'https://iam.example.com/api', serviceAuth })
 * const account = await client.lookupAccount('person@example.com')
 * await client.resetTotp({ authId: account.authId, reason: 'Lost phone', operatorId: 'staff-42' })
 * ```
 */
export class TotpServiceClient extends IamApiClient {
  readonly #serviceAuth: TotpServiceClientOptions['serviceAuth']
  readonly #exchangeUrl: string

  /** Binds this client to `options.baseUrl` and the service credential `options.serviceAuth`. */
  constructor(options: TotpServiceClientOptions) {
    super(options)
    this.#serviceAuth = options.serviceAuth
    this.#exchangeUrl = `${options.baseUrl.replace(/\/+$/, '')}/admin/service/token`
  }

  /**
   * Finds the account whose email is exactly `email`. The address travels in the body, never in a
   * URL, and is not part of the answer.
   *
   * @throws {RestClientError} `realHttpStatus === 404` (`code` `USER_NOT_FOUND`) when no visible
   * person has it; `403` when this service is not authorized; `429` when the lookup limit is spent.
   */
  public async lookupAccount(email: string): Promise<ServiceAccountLookup> {
    return await this.http.post<ServiceAccountLookup>('admin/service/accounts/lookup', {
      body: JSON.stringify({ email }),
      headers: await this.#serviceAuth(this.#exchangeUrl),
    })
  }

  /**
   * Removes the authenticator app and the backup codes of the account `authId` on behalf of the
   * operator `operatorId` (their id in this service's own directory), and emails the account's
   * owner. `iam` records this service, the operator and the reason in its audit trail.
   *
   * @param input.reason Why, 1 to 200 characters once trimmed.
   * @param input.operatorId 1 to 128 characters of letters, digits and `_ . : @ -`.
   * @throws {RestClientError} `realHttpStatus === 403` when this service is not authorized or the
   * operator id is the target's own (`code` `TOTP_RESET_SELF`); `404` when the account does not
   * exist; `409` (`code` `TOTP_NOT_ENABLED`) when it has no authenticator app; `400` for a body
   * that does not validate.
   */
  public async resetTotp(
    input: { authId: string; reason: string; operatorId: string },
  ): Promise<TotpResetResult> {
    return await this.http.post<TotpResetResult>('admin/service/totp/reset', {
      body: JSON.stringify({
        authId: input.authId,
        reason: input.reason,
        operator: { id: input.operatorId },
      }),
      headers: await this.#serviceAuth(this.#exchangeUrl),
    })
  }

  /** One page of the recorded resets, newest first; `authId` keeps the resets of one account. */
  public async listResets(
    options: { authId?: string; page?: number; limit?: number } = {},
  ): Promise<TotpResetsPage> {
    const query = new URLSearchParams()
    if (options.authId) query.set('authId', options.authId)
    if (options.page) query.set('page', String(options.page))
    if (options.limit) query.set('limit', String(options.limit))
    const search = query.toString()
    return await this.http.get<TotpResetsPage>(
      `admin/service/totp/resets${search ? `?${search}` : ''}`,
      { headers: await this.#serviceAuth(this.#exchangeUrl) },
    )
  }
}
