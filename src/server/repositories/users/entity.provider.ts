import type { ZanixMongoConnector } from '@zanix/datamaster'
import type { UsersAttrs } from './model.defs.ts'

import { Provider, ZanixProvider } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import { blocksSignIn, SIGN_IN_BLOCKING_USER_STATUS } from 'utils/constants.ts'

/**
 * Provider for the `users` model — profile data for this project's `users` domain. See
 * `model.defs.ts` for why this stays separate from the `auth` collection (credentials/session
 * state), and why the relationship is reached only from `auth.userId`, never a back-reference here.
 *
 * Decorated with an explicit `'usersRepository'` slot for the same reason as `AuthRepository`
 * (see that class's own doc): every `AuthService`/`PasswordService` method that gates on
 * `assertActive` reaches this class from a Space page bound via `@Page({ Interactor: ... })`, and
 * Vite's SSR pipeline re-evaluates this file into a second class object independent of the one
 * `zanix space dev`'s native process loaded at boot. The named slot resolves both evaluations to
 * the same cached singleton instead of splitting into two, avoiding the class-identity lookup
 * failure a plain `@Provider()` would hit here.
 *
 * @class
 * @extends ZanixProvider
 */
@Provider('usersRepository')
export class UsersRepository extends ZanixProvider<{ database: ZanixMongoConnector }> {
  /** The Mongoose model bound to the `users` collection. */
  private Model
  constructor() {
    super()
    this.Model = this.database.getModel<UsersAttrs>('users')
  }

  /** Creates a new `users` profile. `status` defaults to `'ACTIVE'` when omitted. */
  public registerUser(userData: Partial<UsersAttrs>) {
    const userDoc = new this.Model(userData)
    return userDoc.save()
  }

  /** Finds a `users` profile by its own `id`. */
  public findById(userId?: string) {
    if (!userId) return undefined
    return this.Model.findById(userId).exec()
  }

  /**
   * Updates an existing `users` profile.
   * ⚠️ Ensure that only existing records are updated, or validate their existence before
   * performing the update.
   *
   * @param userData Fields to update — must include `id`.
   * @param options.applyProtection Whether to apply this model's own data policies (mask getter)
   *   to the fields being written, e.g. masking a plain-text `phoneNumber`.
   */
  public updateUser(
    userData: Partial<UsersAttrs> & { id: string },
    options: { applyProtection?: boolean } = {},
  ) {
    const { applyProtection } = options
    const { id, ...data } = userData
    return this.Model.updateOne({ _id: id }, { $set: data }, { useDataPolicies: applyProtection })
      .exec()
  }

  /**
   * Paginated, filterable/searchable listing of profiles — the admin-facing browse surface (see
   * `UsersController.search`). `query` matches across `firstName`/`lastName`/`phoneNumber`.
   */
  public searchUsers(
    options: {
      status?: UserStatus
      query?: string
      page?: number
      limit?: number
      sortBy?: Record<string, 1 | -1>
    } = {},
  ) {
    const { query, status, limit, page, sortBy: sort } = options

    return this.Model.paginate({
      page,
      limit,
      sort,
      filter: status ? { status } : {},
      search: { query, fields: ['firstName', 'lastName', 'phoneNumber'] },
    })
  }

  /**
   * Throws when `userId` resolves to a profile whose `status` blocks login (`'INACTIVE'`/
   * `'DELETED'`) — the shared gate every login/session-refresh/recovery path in
   * `AuthService`/`PasswordService` runs before issuing tokens or dispatching a recovery code.
   *
   * A no-op when `userId` is unset or resolves to no profile at all — an `auth` record with no
   * linked profile (e.g. a system/service account) is never gated on a profile that was never
   * assigned.
   *
   * @throws {HttpError} `FORBIDDEN` when the linked profile is `'INACTIVE'`/`'DELETED'`.
   */
  public async assertActive(userId?: string): Promise<void> {
    if (!userId) return
    const user = await this.findById(userId)
    if (!user) return

    if (!blocksSignIn(user.status)) return
    throw new HttpError('FORBIDDEN', {
      message: user.status === 'DELETED'
        ? 'This account no longer exists.'
        : 'This account has been deactivated.',
    })
  }

  /**
   * The ids, among `userIds`, of the profiles whose `status` blocks sign-in (see
   * {@linkcode blocksSignIn}) — one query. An id with no profile is not in the answer, matching
   * `assertActive`, which lets an account with no profile through.
   */
  public async findSignInBlockedIds(userIds: string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set()
    const users = await this.Model.find({
      _id: { $in: userIds },
      status: { $in: SIGN_IN_BLOCKING_USER_STATUS },
    }).select('_id').exec()
    return new Set(users.map((user) => String(user.id ?? user._id)))
  }

  /** The profiles whose id is in `ids`, with one query. */
  public findManyByIds(ids: string[]) {
    if (!ids.length) return Promise.resolve([])
    return this.Model.find({ _id: { $in: ids } }).exec()
  }

  /**
   * Sets a profile's `status` to `previous` only if it is still `expected`; the undo of a status
   * change that left nobody able to manage roles. Answers whether it matched.
   */
  public async restoreStatus(userId: string, expected: UserStatus, previous: UserStatus) {
    const result = await this.Model.updateOne(
      { _id: userId, status: expected },
      { $set: { status: previous } },
    ).exec()
    return result.matchedCount > 0
  }

  /**
   * Sets `userId`'s profile `status` back to `'ACTIVE'` — the write side of the reactivation
   * carve-out, called only by `AuthService.confirmReactivation` after an OTP/OAuth2 identity check
   * and an explicit confirmation (see `AuthService`'s own header doc; `'DELETED'` never reactivates
   * through any path). Takes no status of its own to check — every caller already resolved the profile's
   * current status before deciding this call is warranted.
   */
  public reactivate(userId: string) {
    return this.Model.updateOne({ _id: userId }, { $set: { status: 'ACTIVE' } }).exec()
  }
}
