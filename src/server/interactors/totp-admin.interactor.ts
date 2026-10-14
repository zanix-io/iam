import { HttpError } from '@zanix/errors'
import { Interactor, ZanixInteractor } from '@zanix/server'
import { IAM_ERROR_CODES, RBAC_PERMISSIONS } from 'utils/constants.ts'
import { AuditRepository } from '../repositories/audit/entity.provider.ts'
import { AuthRepository } from '../repositories/auth/entity.provider.ts'
import type { AuthenticationAttrs, HydratedAuth } from '../repositories/auth/model.defs.ts'
import { sendAccountNotice } from './account-notice.ts'
import { audited } from './audit.ts'
import { authorizeActor } from './role-admin.ts'

/** The `action` the audit trail records an operator reset under. */
export const TOTP_RESET_AUDIT_ACTION = 'totp.reset'

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

        const repository = this.providers.get(AuthRepository)
        const account = await repository.findById(authId) as HydratedAuth | undefined | null
        if (!account) throw new HttpError('NOT_FOUND', { message: 'Account not found.' })
        const hasTotp = account.twoFactorAuthConfig?.method === 'totp' ||
          Boolean(account.totpSecret)
        if (!hasTotp) {
          throw new HttpError('CONFLICT', {
            message: 'This account has no authenticator app to reset.',
            code: IAM_ERROR_CODES.totpNotEnabled,
          })
        }

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
        await repository.updateAuth({ id: authId }, { unset })
        note({ after: { totpEnabled: false, backupCodesRemaining: 0 } })

        await sendAccountNotice(
          this.providers,
          this.context,
          account.email?.unmask(),
          'totp-reset-by-operator',
        )
        return { response: 'TOTP reset' }
      },
    )
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
