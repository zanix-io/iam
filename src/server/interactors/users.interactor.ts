import type {
  AdminEditUserRTO,
  SearchUsersRTO,
  UserProfileRTO,
  UserRegisterRTO,
} from '../handlers/rtos/user-settings.ts'

import { HttpError } from '@zanix/errors'
import { Interactor, ZanixInteractor } from '@zanix/server'
import { NotifierProvider } from '@zanix/notifications'
import { AuthRepository } from '../repositories/auth/entity.provider.ts'
import { UsersRepository } from '../repositories/users/entity.provider.ts'
import { PasswordService } from './password.interactor.ts'
import { SERVICE_ID } from 'utils/constants.ts'

/**
 * Business logic for the `users` domain slice — profile/settings management and administrative
 * registration. Credentials/session lifecycle stay in the sibling `AuthService`/`PasswordService`
 * (see `repositories/users/model.defs.ts` for why the two collections stay separate); a profile is
 * always reached FROM its `auth` record via `AuthenticationAttrs.userId`, never the reverse, so
 * every self-service method here starts by resolving the caller's own `auth` record first.
 */
@Interactor()
export class UsersService extends ZanixInteractor {
  /**
   * Resolves the current session's own `auth` record, requiring a linked `users` profile —
   * returned with `userId` narrowed to `string` (never re-checked by callers with a non-null
   * assertion, disallowed by this project's own lint config).
   *
   * @throws {HttpError} `UNAUTHORIZED` with no authenticated session; `NOT_FOUND` when the
   *   session's `auth` record has no linked `users` profile.
   */
  private async resolveOwnAuth(): Promise<{ id: string; userId: string }> {
    const subject = this.context.session?.subject
    if (!subject) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })

    const auth = await this.providers.get(AuthRepository).findById(subject)
    const userId = auth?.userId
    if (!auth || !userId) {
      throw new HttpError('NOT_FOUND', { message: 'No profile is linked to this account.' })
    }
    return { id: auth.id, userId }
  }

  /**
   * Registers a new user profile and its authentication record. Restricted to callers with a
   * valid session — there is no public self-signup endpoint (see `UsersController`'s own doc).
   *
   * When `password` is omitted, the new account is invited to set its own credential through the
   * already-built password-recovery flow (`PasswordService.recovery`) rather than an admin
   * choosing/knowing it. The real, deployed sibling project this domain slice is grounded on
   * doesn't do this: registering a passwordless account there sends only a generic "welcome" email
   * with no way to actually set a password — a real usability/security gap this slice closes.
   *
   * @throws {HttpError} `CONFLICT` when `email` is already registered.
   */
  public async registerUser(data: UserRegisterRTO) {
    const { email, password, firstName, lastName, phoneNumber } = data

    const existing = await this.providers.get(AuthRepository).findByEmail(email)
    if (existing) {
      throw new HttpError('CONFLICT', { message: 'An account already exists for this email.' })
    }

    const createdBy = this.context.session?.subject
    const profile = await this.providers.get(UsersRepository).registerUser({
      firstName,
      lastName,
      phoneNumber,
      createdBy,
    })

    await this.providers.get(AuthRepository).registerAuth({
      email,
      userId: profile.id,
      ...(password ? { password, mustChangePassword: true } : {}),
    })

    await this.providers.get(NotifierProvider).email({
      to: email,
      subject: `Welcome to ${SERVICE_ID}`,
      zanixTemplate: 'welcome',
      data: {},
    }, { useWorker: 'one-time' })

    if (!password) {
      await this.interactors.get(PasswordService).recovery(email)
    }

    return { response: 'user registered' }
  }

  /**
   * Returns the current session's own profile — the real hydrated document, returned as-is (never
   * spread/hand-adapted): matching `RolesService.getRoleById`'s own identical precedent, this lets
   * the framework's own response serialization (`JSON.stringify` invoking the document's `toJSON()`)
   * apply this model's declared data-access policy correctly (getters, `id` virtual, any
   * `internal`/`private`/`protected` field visibility) — a hand-rolled `{ ...user, ... }` spread
   * bypasses all of that, copying the live document's own internal Mongoose bookkeeping
   * (`$__`/`_doc`/...) as plain enumerable properties instead of the real profile fields.
   *
   * @throws {HttpError} `UNAUTHORIZED` with no authenticated session; `NOT_FOUND` when the
   *   session's `auth` record has no linked `users` profile, or the linked profile no longer
   *   resolves to a real document.
   */
  public async getOwnProfile() {
    const auth = await this.resolveOwnAuth()
    const user = await this.providers.get(UsersRepository).findById(auth.userId)
    if (!user) throw new HttpError('NOT_FOUND', { message: 'User not found.' })
    return user
  }

  /** Updates the current session's own profile — never `status`, that's admin-only. */
  public async updateOwnProfile(data: UserProfileRTO) {
    const auth = await this.resolveOwnAuth()
    await this.providers.get(UsersRepository).updateUser({ ...data, id: auth.userId }, {
      applyProtection: true,
    })
    return { response: 'profile updated' }
  }

  /**
   * Deactivates the CALLER's own account — sets the linked `users` profile's `status` to
   * `'INACTIVE'`. Self-scoped via `resolveOwnAuth()` (the session's own subject only — no `id`
   * parameter exists anywhere in this call chain, so this is structurally incapable of acting on
   * another user's account). Deliberately bypasses `AdminEditUserRTO`/`EDITABLE_USER_STATUS` — the
   * same reasoning `updateOwnProfile` already uses to let self-service touch a field the admin RTO
   * doesn't expose (see that method's own doc).
   *
   * Reversible, but not from here: this method only ever moves `status` to `'INACTIVE'` (see
   * `deleteOwnAccount` for `'DELETED'`), never back to `'ACTIVE'`. Reactivation happens
   * automatically, and only as a side effect of a successful login via email OTP or Google OAuth2
   * — see `AuthService`'s own header doc for that carve-out.
   */
  public async deactivateOwnAccount() {
    const auth = await this.resolveOwnAuth()
    await this.providers.get(UsersRepository).updateUser({ id: auth.userId, status: 'INACTIVE' })
    return { response: 'account deactivated' }
  }

  /**
   * Deletes the CALLER's own account — sets the linked `users` profile's `status` to `'DELETED'`.
   * Self-scoped via `resolveOwnAuth()`, the same structural guarantee as `deactivateOwnAccount`'s
   * own doc. Unlike a self-deactivate, this is NOT reversible through any login path —
   * `'DELETED'` never auto-reactivates (see `AuthService`'s own header doc).
   */
  public async deleteOwnAccount() {
    const auth = await this.resolveOwnAuth()
    await this.providers.get(UsersRepository).updateUser({ id: auth.userId, status: 'DELETED' })
    return { response: 'account deleted' }
  }

  /**
   * Gets a profile by `id`. Admin-scoped — gated at the handler level by `RBAC_PERMISSIONS.userRead`/
   * `userWrite` (see `UsersController`'s own doc).
   *
   * @throws {HttpError} `NOT_FOUND` when no profile exists for `id`.
   */
  public async getUserById(id: string) {
    const user = await this.providers.get(UsersRepository).findById(id)
    if (!user) throw new HttpError('NOT_FOUND', { message: 'User not found.' })
    return user
  }

  /**
   * Updates a profile by `id`, including its `status` (the only admin-only field —
   * `EDITABLE_USER_STATUS` never includes `'ACTIVE'`, so this can never silently reactivate an
   * account). Transitioning to `'INACTIVE'`/`'DELETED'` needs no explicit revoke action of its
   * own: every login/refresh path in `AuthService`/`PasswordService` re-checks this same, live
   * `status` on every attempt (`UsersRepository.assertActive`), so a deactivated/deleted account is
   * blocked from refreshing past its CURRENT access token on its very next attempt, with no
   * separately stored session state to invalidate here. That current access token itself stays
   * valid until it naturally expires — stateless JWTs having no revocation list is an accepted,
   * ecosystem-wide tradeoff, not a gap specific to this method.
   *
   * @throws {HttpError} `NOT_FOUND` when no profile exists for `id`.
   */
  public async updateUserById(id: string, data: AdminEditUserRTO) {
    const user = await this.providers.get(UsersRepository).findById(id)
    if (!user) throw new HttpError('NOT_FOUND', { message: 'User not found.' })

    await this.providers.get(UsersRepository).updateUser({ ...data, id }, {
      applyProtection: true,
    })

    return { response: 'user updated' }
  }

  /**
   * Paginated, filterable/searchable admin listing of profiles — the real hydrated documents,
   * returned as-is. See `getOwnProfile`'s own doc for why this stopped hand-adapting each entry.
   */
  public async searchUsers(options: Partial<SearchUsersRTO>) {
    return await this.providers.get(UsersRepository).searchUsers(options)
  }
}
