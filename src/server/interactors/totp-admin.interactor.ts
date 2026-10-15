import { HttpError } from '@zanix/errors'
import { decodeJWT, exchangeServiceCredential } from '@zanix/auth'
import { Interactor, ZanixInteractor } from '@zanix/server'
import { IAM_ERROR_CODES, RBAC_PERMISSIONS, totpResetServices } from 'utils/constants.ts'
import { AuditRepository } from '../repositories/audit/entity.provider.ts'
import { AuthRepository } from '../repositories/auth/entity.provider.ts'
import { UsersRepository } from '../repositories/users/entity.provider.ts'
import type { AuthenticationAttrs, HydratedAuth } from '../repositories/auth/model.defs.ts'
import { sendAccountNotice } from './account-notice.ts'
import { audited, type AuditNote } from './audit.ts'
import { authorizeActor, serialized } from './role-admin.ts'

/** The `action` the audit trail records an operator reset under. */
export const TOTP_RESET_AUDIT_ACTION = 'totp.reset'

/** Whether the account has an authenticator app to reset: set as its second factor or enrolled. */
const hasAuthenticator = (
  account: { twoFactorAuthConfig?: { method?: string }; totpSecret?: unknown },
) => account.twoFactorAuthConfig?.method === 'totp' || Boolean(account.totpSecret)

const totpNotEnabled = () =>
  new HttpError('CONFLICT', {
    message: 'This account has no authenticator app to reset.',
    code: IAM_ERROR_CODES.totpNotEnabled,
  })

/**
 * Operator tools for the authenticator app of an account: the way back in for a person who lost
 * their authenticator, whose only other route (`DELETE /login/totp`) needs the factor they no
 * longer have. Both operations need the `totp-reset` permission.
 */
@Interactor()
export class TotpAdminService extends ZanixInteractor {
  /**
   * Removes the authenticator app of the account `authId`: its secret, the second-factor setting
   * when it is TOTP, a pending enrollment and every backup code. The person signs in with their
   * remaining methods and enables the app again. The owner is emailed that support removed the
   * second factor (the reason is not part of the email).
   *
   * Like every role-administration operation it needs an account, not a service credential, whose
   * `totp-reset` permission is checked against the database now; the call is recorded in the audit
   * trail as `totp.reset` (operator, time, target, reason and outcome) and fails closed if the
   * trail cannot be written. Sessions already issued to the account are not revoked: `@zanix/auth`
   * keeps session tokens stateless and blocklists them by token only.
   *
   * @param reason Why the reset is done, trimmed and already validated (1 to 200 characters).
   * @throws {HttpError} `FORBIDDEN` when the caller is not an active account that holds
   *   `totp-reset`, or targets their own account (`TOTP_RESET_SELF`); `NOT_FOUND` when the account
   *   does not exist; `CONFLICT` (`TOTP_NOT_ENABLED`) when it has no authenticator app.
   */
  public resetTotp(authId: string, reason: string) {
    return audited(
      this.providers,
      this.context,
      {
        action: TOTP_RESET_AUDIT_ACTION,
        target: { kind: 'account', id: authId },
        request: { reason },
      },
      async (note) => {
        await authorizeActor(this.providers, this.context.session, RBAC_PERMISSIONS.totpReset)
        if (String(this.context.session?.subject) === authId) {
          throw new HttpError('FORBIDDEN', {
            message: 'You cannot reset the authenticator app of your own account.',
            code: IAM_ERROR_CODES.totpResetSelf,
          })
        }

        return await this.#removeAuthenticator(authId, note)
      },
    )
  }

  /**
   * The shared effect of every authenticator reset: removes the secret, the second-factor setting
   * when it is TOTP, a pending enrollment and every backup code of `authId`, then emails the owner.
   * The removal is one conditional write, so of any number of concurrent resets exactly one finds
   * an authenticator app to remove and the rest fail with `TOTP_NOT_ENABLED`.
   */
  async #removeAuthenticator(authId: string, note: AuditNote) {
    const repository = this.providers.get(AuthRepository)
    const account = await repository.findById(authId) as HydratedAuth | undefined | null
    if (!account) throw new HttpError('NOT_FOUND', { message: 'Account not found.' })
    if (!hasAuthenticator(account)) throw totpNotEnabled()

    note({
      before: {
        totpEnabled: account.twoFactorAuthConfig?.method === 'totp',
        backupCodesRemaining: await repository.countBackupCodes(authId),
      },
    })
    const unset: (keyof AuthenticationAttrs)[] = [
      'totpSecret',
      'pendingTotpSecret',
      'pendingTotpExpiresAt',
      'backupCodeHashes',
      'backupCodesGeneratedAt',
    ]
    // The second-factor setting is cleared only when it is the authenticator app: it can also
    // name an OTP delivery channel, which a reset leaves alone.
    if (account.twoFactorAuthConfig?.method === 'totp') unset.push('twoFactorAuthConfig')
    const written = await repository.updateAuth({ id: authId }, {
      unset,
      onlyIf: {
        $or: [{ 'twoFactorAuthConfig.method': 'totp' }, { totpSecret: { $exists: true } }],
      },
    }) as { matchedCount?: number } | undefined
    if (written?.matchedCount === 0) throw totpNotEnabled()
    note({ after: { totpEnabled: false, backupCodesRemaining: 0 } })

    await sendAccountNotice(
      this.providers,
      this.context,
      account.email?.unmask(),
      'totp-reset-by-operator',
    )
    return { response: 'TOTP reset' }
  }

  /**
   * Refuses unless the session is a service credential of a service listed in
   * `IAM_TOTP_RESET_SERVICES`. Unset or empty, nobody is listed and every call is refused.
   *
   * @returns The calling service's id.
   * @throws {HttpError} `FORBIDDEN` (`SERVICE_CREDENTIAL_REQUIRED`) for any other kind of session,
   *   a user's included; `FORBIDDEN` (`SERVICE_NOT_AUTHORIZED`) for a service that is not listed.
   */
  #assertTrustedService(): string {
    const { session } = this.context
    if (session?.type !== 'api' || !session.subject) {
      throw new HttpError('FORBIDDEN', {
        message: 'This endpoint is for trusted services, not for user sessions.',
        code: IAM_ERROR_CODES.serviceCredentialRequired,
      })
    }
    const serviceId = String(session.subject)
    if (!totpResetServices().includes(serviceId)) {
      throw new HttpError('FORBIDDEN', {
        message: 'This service is not authorized to act on authenticator apps.',
        code: IAM_ERROR_CODES.serviceNotAuthorized,
      })
    }
    return serviceId
  }

  /**
   * Exchanges the signed assertion of a service for a short-lived `api` access token
   * (`POST /admin/service/token`), the credential the other `/admin/service/*` endpoints take in
   * `X-Znx-Authorization`. Only a service listed in `IAM_TOTP_RESET_SERVICES` is exchanged, and
   * only when its public key is registered as `JWK_PUB_<serviceId>`: the assertion is verified
   * against that key by `@zanix/auth`'s `exchangeServiceCredential`, and the token carries no
   * permissions, as the caller never gets to ask for any.
   *
   * @throws {HttpError} `FORBIDDEN` (`SERVICE_NOT_AUTHORIZED`) for a service that is not listed, or
   *   an assertion that names none; `BAD_REQUEST` for an assertion that does not verify.
   */
  public exchangeServiceToken(assertion: string) {
    let issuer: unknown
    try {
      issuer = decodeJWT(assertion).payload.iss
    } catch {
      throw new HttpError('BAD_REQUEST', { message: 'The assertion is not a valid token.' })
    }
    if (typeof issuer !== 'string' || !totpResetServices().includes(issuer)) {
      throw new HttpError('FORBIDDEN', {
        message: 'This service is not authorized to act on authenticator apps.',
        code: IAM_ERROR_CODES.serviceNotAuthorized,
      })
    }
    return exchangeServiceCredential(assertion)
  }

  /**
   * Finds the account whose email is exactly `email` for a trusted service that acts for an
   * operator (`POST /admin/service/accounts/lookup`), and answers what a reset needs to know: the
   * `authId`, the profile `userId` and `status`, whether an authenticator app is set and how many
   * backup codes remain. Never the email, hashes or secrets. The match uses the same exact-email
   * mechanism as the operator lookup (`GET /users/lookup`); an address with no account, an account
   * with no profile and a `DELETED` profile all answer the same `NOT_FOUND` (`USER_NOT_FOUND`).
   *
   * Audited as `accounts.service-lookup` (the calling service as actor, the profile as target, never
   * the email); like the operator lookup the trail does not fail closed, as it is a read.
   *
   * @throws {HttpError} `FORBIDDEN` as {@linkcode TotpAdminService.resetTotpForOperator}; `NOT_FOUND`
   *   as above.
   */
  public lookupAccountForService(email: string) {
    return audited(
      this.providers,
      this.context,
      { action: 'accounts.service-lookup', target: { kind: 'account' } },
      async (note) => {
        this.#assertTrustedService()
        const repository = this.providers.get(AuthRepository)
        const account = await repository.findByEmailForLookup(email)
        const profile = account?.userId
          ? await this.providers.get(UsersRepository).findById(String(account.userId))
          : undefined
        if (!account || !profile || profile.status === 'DELETED') {
          throw new HttpError('NOT_FOUND', {
            message: 'No user matches the request.',
            code: IAM_ERROR_CODES.userNotFound,
          })
        }
        const authId = String(account.id)
        note({ targetId: authId })
        return {
          authId,
          userId: String(serialized(profile).id),
          status: profile.status,
          hasTotp: hasAuthenticator(account),
          backupCodesRemaining: await repository.countBackupCodes(authId),
        }
      },
      { failOpen: true },
    )
  }

  /**
   * Removes the authenticator app of `authId` for a trusted service that acts for an operator
   * (`POST /admin/service/totp/reset`), with exactly the effect of {@linkcode TotpAdminService.resetTotp}.
   * The service vouches for `operatorId`, the identity of the person who asked: an opaque id the
   * audit event records next to the service, the target and `reason`. The event fails closed like
   * every reset.
   *
   * @param reason Why, trimmed and already validated (1 to 200 characters).
   * @param operatorId The operator's id in the service's own directory, already validated.
   * @throws {HttpError} `FORBIDDEN` (`SERVICE_CREDENTIAL_REQUIRED`, `SERVICE_NOT_AUTHORIZED`) as
   *   above, or (`TOTP_RESET_SELF`) when `operatorId` is the target's own `authId`; `NOT_FOUND` when
   *   the account does not exist; `CONFLICT` (`TOTP_NOT_ENABLED`) when it has no authenticator app.
   */
  public resetTotpForService(authId: string, reason: string, operatorId: string) {
    return audited(
      this.providers,
      this.context,
      {
        action: TOTP_RESET_AUDIT_ACTION,
        target: { kind: 'account', id: authId },
        request: { reason, operatorId },
      },
      (note) => {
        this.#assertTrustedService()
        if (operatorId === authId) {
          throw new HttpError('FORBIDDEN', {
            message: 'You cannot reset the authenticator app of your own account.',
            code: IAM_ERROR_CODES.totpResetSelf,
          })
        }
        return this.#removeAuthenticator(authId, note)
      },
    )
  }

  /**
   * One page of the resets recorded in the audit trail for a trusted service
   * (`GET /admin/service/totp/resets`): the same events as {@linkcode TotpAdminService.listResets},
   * which carry the calling service and the operator id of the resets made through it.
   *
   * @throws {HttpError} `FORBIDDEN` as {@linkcode TotpAdminService.resetTotpForService}.
   */
  public async listResetsForService(
    options: { authId?: string; page?: number; limit?: number } = {},
  ) {
    this.#assertTrustedService()
    return await this.listResets(options)
  }

  /**
   * One page of the operator resets recorded in the audit trail, newest first, optionally only
   * those of the account `authId`. The same events `GET /audit?action=totp.reset` lists, for
   * callers that hold `totp-reset` and not `audit-read`.
   */
  public listResets(options: { authId?: string; page?: number; limit?: number } = {}) {
    return this.providers.get(AuditRepository).searchEvents({
      action: TOTP_RESET_AUDIT_ACTION,
      targetId: options.authId,
      page: options.page,
      limit: options.limit,
    })
  }
}
