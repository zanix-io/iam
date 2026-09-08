import type { ZanixMongoConnector } from '@zanix/datamaster'
import type { UsersAttrs } from './model.defs.ts'

import { Provider, ZanixProvider } from '@zanix/server'
import { HttpError } from '@zanix/errors'

/**
 * Provider for the `users` model — profile data for this project's `users` domain slice. See
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
   * A no-op when `userId` is unset or resolves to no profile at all — an `auth` record created
   * before this slice existed (or never meant to carry a linked profile, e.g. a future
   * system/service account) is never gated on a profile that was never assigned.
   *
   * @throws {HttpError} `FORBIDDEN` when the linked profile is `'INACTIVE'`/`'DELETED'`.
   */
  public async assertActive(userId?: string): Promise<void> {
    if (!userId) return
    const user = await this.findById(userId)
    if (!user) return

    if (user.status === 'INACTIVE') {
      throw new HttpError('FORBIDDEN', { message: 'This account has been deactivated.' })
    }
    if (user.status === 'DELETED') {
      throw new HttpError('FORBIDDEN', { message: 'This account no longer exists.' })
    }
  }
}
