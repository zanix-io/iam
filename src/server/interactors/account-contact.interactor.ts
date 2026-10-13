import { HttpError } from '@zanix/errors'
import { Interactor, ZanixInteractor } from '@zanix/server'
import { AuthRepository } from '../repositories/auth/entity.provider.ts'
import { UsersRepository } from '../repositories/users/entity.provider.ts'

/** The most accounts one call may ask about. */
export const MAX_CONTACT_EMAIL_BATCH = 100

/**
 * Hands the login address of accounts to the services that deliver messages for them, so no other
 * service stores an address of its own: a service keeps the account id, and the address is read
 * from here at the moment of sending.
 *
 * It is reached only through the `resolveAccountEmails` operation of the `auth` app, which is
 * limited to the apps named in its `allowedCallers`; it has no HTTP route and no session, so a
 * person's token can never ask it for anyone's address. An account that cannot sign in
 * (`INACTIVE` or `DELETED`) is left out, so nothing is delivered to a closed account.
 */
@Interactor()
export class AccountContactService extends ZanixInteractor {
  /**
   * The login address of each active account among `authIds`, keyed by account id. An unknown or
   * closed account is absent from the answer; the caller treats absence as "nothing to deliver".
   *
   * @throws {HttpError} `BAD_REQUEST` when `authIds` is not a list of strings or holds more than
   *   {@linkcode MAX_CONTACT_EMAIL_BATCH}.
   */
  public async resolveEmails(authIds: unknown): Promise<Record<string, string>> {
    if (!Array.isArray(authIds) || authIds.some((id) => typeof id !== 'string' || !id)) {
      throw new HttpError('BAD_REQUEST', { message: '`authIds` must be a list of account ids.' })
    }
    const unique = [...new Set(authIds as string[])]
    if (unique.length > MAX_CONTACT_EMAIL_BATCH) {
      throw new HttpError('BAD_REQUEST', {
        message: `At most ${MAX_CONTACT_EMAIL_BATCH} accounts per call.`,
      })
    }

    const accounts = await this.providers.get(AuthRepository).findContactEmails(unique)
    const userIds = accounts.flatMap((account) => account.userId ? [account.userId] : [])
    const blocked = await this.providers.get(UsersRepository).findSignInBlockedIds(userIds)

    const emails: Record<string, string> = {}
    for (const account of accounts) {
      if (account.userId && blocked.has(account.userId)) continue
      emails[account.id] = account.email
    }
    return emails
  }
}
