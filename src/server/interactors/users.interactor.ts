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
import { RolesRepository } from '../repositories/roles/entity.provider.ts'
import { UsersRepository } from '../repositories/users/entity.provider.ts'
import { PasswordService } from './password.interactor.ts'
import { audited } from './audit.ts'
import {
  assertCanGrant,
  authorizeActor,
  changeProtectingAdministrator,
  permissionsOfUser,
  serialized,
} from './role-admin.ts'
import {
  blocksSignIn,
  IAM_ERROR_CODES,
  RBAC_PERMISSIONS,
  SERVICE_ID,
  USER_READ_PERMISSIONS,
} from 'utils/constants.ts'
import { effectiveRoleIds } from 'utils/rbac.ts'

/**
 * Business logic for the `users` domain — profile/settings management and administrative
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
   * Registers a new user profile and its authentication record — administrative registration
   * (`UsersController.register` requires `RBAC_PERMISSIONS.userWrite`); self-registration happens
   * only through OTP/OAuth2 login (see `AuthService`).
   *
   * When `password` is omitted, the new account is invited to set its own credential through the
   * already-built password-recovery flow (`PasswordService.recovery`) rather than an admin
   * choosing/knowing it.
   *
   * The caller must still hold `user-write` in the database, not only in its token
   * (`ACTOR_LACKS_PERMISSION`).
   *
   * @throws {HttpError} `CONFLICT` when `email` is already registered; `FORBIDDEN` as above.
   */
  public async registerUser(data: UserRegisterRTO) {
    const { email, password, firstName, lastName, phoneNumber } = data
    await authorizeActor(this.providers, this.context.session, RBAC_PERMISSIONS.userWrite)

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
   * another user's account). Deliberately bypasses `AdminEditUserRTO`/`EDITABLE_USER_STATUS`: the
   * target is always the caller's own profile.
   *
   * Reversible, but not from here: this method only ever moves `status` to `'INACTIVE'` (see
   * `deleteOwnAccount` for `'DELETED'`), never back to `'ACTIVE'`. A later successful OTP or OAuth2
   * login offers reactivation behind an explicit confirmation step — see `AuthService`'s own header
   * doc for that carve-out.
   *
   * @throws {HttpError} `CONFLICT` when this is the last account able to manage roles.
   */
  public async deactivateOwnAccount() {
    const auth = await this.resolveOwnAuth()
    return await audited(
      this.providers,
      this.context,
      {
        action: 'users.deactivate-own',
        target: { kind: 'user', id: auth.userId },
        request: { status: 'INACTIVE' },
      },
      (note) => this.#blockProfile(auth.userId, 'INACTIVE', {}, 'account deactivated', note),
    )
  }

  /**
   * Deletes the CALLER's own account — sets the linked `users` profile's `status` to `'DELETED'`.
   * Self-scoped via `resolveOwnAuth()`, the same structural guarantee as `deactivateOwnAccount`'s
   * own doc. Unlike a self-deactivate, this is NOT reversible through any login path —
   * `'DELETED'` never reactivates (see `AuthService`'s own header doc).
   *
   * @throws {HttpError} `CONFLICT` when this is the last account able to manage roles.
   */
  public async deleteOwnAccount() {
    const auth = await this.resolveOwnAuth()
    return await audited(
      this.providers,
      this.context,
      {
        action: 'users.delete-own',
        target: { kind: 'user', id: auth.userId },
        request: { status: 'DELETED' },
      },
      (note) => this.#blockProfile(auth.userId, 'DELETED', {}, 'account deleted', note),
    )
  }

  /**
   * Gets a profile by `id`, with the `authId` of its account and that account's `roleIds` (the
   * link the roles endpoints need; ids only, no contact data). Admin-scoped — gated at the handler level by `RBAC_PERMISSIONS.userRead`/
   * `userWrite` (see `UsersController`'s own doc).
   *
   * @throws {HttpError} `NOT_FOUND` when no profile exists for `id`.
   */
  public async getUserById(id: string) {
    const user = await this.providers.get(UsersRepository).findById(id)
    if (!user) throw new HttpError('NOT_FOUND', { message: 'User not found.' })
    const [account] = await this.#accountsOf([user])
    return { ...serialized(user), authId: account?.id, roleIds: account?.roleIds ?? [] }
  }

  /**
   * Finds the one person whose account has exactly this `email`, for an administrator who must pick
   * someone without knowing their `authId`. Admin-scoped: gated at the handler by
   * `RBAC_PERMISSIONS.userRead`/`userWrite`, and the caller must still hold one of them in the
   * database (`ACTOR_LACKS_PERMISSION`), like every other administration operation.
   *
   * The match is on the whole address only (see `AuthRepository.findByEmailForLookup`). The answer
   * is the same projection for every hit and never contains the email, the phone or any other
   * contact data: `authId`, `userId`, `firstName`, `lastName`, `status` and `roleIds`. A person
   * whose profile is `INACTIVE` is returned with that status. When nothing is returned the answer
   * is always the same `USER_NOT_FOUND`, whether the address has no account, the account has no
   * profile, or the profile is `DELETED`, so a caller cannot tell them apart.
   *
   * Each call is audited as `users.lookup` (`ok`, `not-found`, `denied`...), with the person's
   * profile id as the target when there is one and never the email nor its digest. The trail does
   * not fail closed here: a read that changes nothing keeps working when the audit store is down
   * (the failure is logged, and the call leaves no event).
   *
   * @throws {HttpError} `NOT_FOUND` (`USER_NOT_FOUND`) as above; `FORBIDDEN` when the caller is not
   *   an active account or no longer holds `user-read`/`user-write`.
   */
  public lookupUserByEmail(email: string) {
    return audited(
      this.providers,
      this.context,
      { action: 'users.lookup', target: { kind: 'user' } },
      async (note) => {
        await authorizeActor(this.providers, this.context.session, USER_READ_PERMISSIONS)
        const account = await this.providers.get(AuthRepository).findByEmailForLookup(email)
        const profile = account?.userId
          ? await this.providers.get(UsersRepository).findById(String(account.userId))
          : undefined
        if (!account || !profile || profile.status === 'DELETED') {
          throw new HttpError('NOT_FOUND', {
            message: 'No user matches the request.',
            code: IAM_ERROR_CODES.userNotFound,
          })
        }
        note({ targetId: String(profile.id) })
        const { firstName, lastName } = serialized(profile)
        return {
          authId: String(account.id),
          userId: String(profile.id),
          firstName,
          lastName,
          status: profile.status,
          roleIds: effectiveRoleIds(account),
        }
      },
      { failOpen: true },
    )
  }

  /** The accounts linked to `profiles`, with one query. */
  #accountsOf(profiles: readonly { id?: unknown }[]) {
    return this.providers.get(AuthRepository).findRolesByUserIds(
      profiles.map((profile) => String(profile.id)),
    )
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
   * Every edit is audited (`users.edit`, or `users.block` when the new status blocks sign-in) and
   * needs the caller to still hold `user-write` in the database (`ACTOR_LACKS_PERMISSION`).
   * Blocking a person is refused with `FORBIDDEN` (`ROLE_GRANT_EXCEEDS_SCOPE`) when the person's
   * roles grant a permission the caller doesn't hold — a `user-write` holder cannot block someone
   * it does not cover.
   *
   * @throws {HttpError} `NOT_FOUND` when no profile exists for `id`; `FORBIDDEN` as above;
   *   `CONFLICT` (`LAST_ADMINISTRATOR`) when the profile belongs to the last account able to manage
   *   roles.
   */
  public updateUserById(id: string, data: AdminEditUserRTO) {
    const status = blocksSignIn(data.status) ? data.status : undefined
    return audited(
      this.providers,
      this.context,
      {
        action: status ? 'users.block' : 'users.edit',
        target: { kind: 'user', id },
        request: { status: data.status },
      },
      async (note) => {
        // Blocking a person takes away everything their roles grant, so the caller must hold it
        // all; the role catalog read for that is reused by the last-administrator check.
        const catalog = status
          ? await this.providers.get(RolesRepository).findAllWithPermissions()
          : undefined
        const held = await authorizeActor(
          this.providers,
          this.context.session,
          RBAC_PERMISSIONS.userWrite,
          catalog,
        )
        const user = await this.providers.get(UsersRepository).findById(id)
        if (!user) throw new HttpError('NOT_FOUND', { message: 'User not found.' })
        if (!status) {
          await this.providers.get(UsersRepository).updateUser({ ...data, id }, {
            applyProtection: true,
          })
          return { response: 'user updated' }
        }
        assertCanGrant(held, await permissionsOfUser(this.providers, id, catalog ?? []))
        return await this.#blockProfile(id, status, data, 'user updated', note, catalog)
      },
    )
  }

  /**
   * Moves the profile `userId` to a status that blocks sign-in through
   * `changeProtectingAdministrator`: the last account able to manage roles cannot be blocked, and
   * if two requests together blocked the last ones, the status is put back. `fields` are the other
   * edits of the same request, written together with the status. Runs inside the audit event of
   * its caller.
   */
  async #blockProfile(
    userId: string,
    status: 'INACTIVE' | 'DELETED',
    fields: Partial<AdminEditUserRTO>,
    response: string,
    note: Parameters<Parameters<typeof audited>[3]>[0],
    catalog?: Parameters<typeof changeProtectingAdministrator>[3],
  ) {
    const repository = this.providers.get(UsersRepository)
    const previous = (await repository.findById(userId))?.status ?? 'ACTIVE'
    note({ before: { status: previous }, after: { status } })
    await changeProtectingAdministrator(
      this.providers,
      { kind: 'user-blocked', userId },
      {
        write: async () => {
          await repository.updateUser({ ...fields, id: userId, status }, { applyProtection: true })
          return true
        },
        undo: () => repository.restoreStatus(userId, status, previous),
      },
      catalog,
    )
    return { response }
  }

  /**
   * Paginated, filterable/searchable admin listing of profiles — the real hydrated documents,
   * returned as-is, each with the `authId` and `roleIds` of its account (`roleIds` is `[]`, and
   * `authId` absent, for a profile with no account). See `getOwnProfile`'s own doc for why entries
   * are never hand-adapted.
   */
  public async searchUsers(options: Partial<SearchUsersRTO>) {
    const page = await this.providers.get(UsersRepository).searchUsers(options)
    const accounts = new Map((await this.#accountsOf(page.docs)).map((a) => [a.userId, a]))
    return {
      ...page,
      docs: page.docs.map((user) => {
        const account = accounts.get(String(user.id))
        return { ...serialized(user), authId: account?.id, roleIds: account?.roleIds ?? [] }
      }),
    }
  }
}
