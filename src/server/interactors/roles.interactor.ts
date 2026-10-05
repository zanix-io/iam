import type {
  AccountRolesRTO,
  AssignRoleRTO,
  CreateRoleRTO,
  EditRoleRTO,
  SearchRolesRTO,
} from '../handlers/rtos/roles.ts'

import { HttpError } from '@zanix/errors'
import { Interactor, ZanixInteractor } from '@zanix/server'
import { AuthRepository } from '../repositories/auth/entity.provider.ts'
import { PermissionsRepository } from '../repositories/permissions/entity.provider.ts'
import { RolesRepository } from '../repositories/roles/entity.provider.ts'
import { UsersRepository } from '../repositories/users/entity.provider.ts'
import { audited } from './audit.ts'
import {
  actorHeld,
  assertActorHolds,
  assertCanGrant,
  authorizeActor,
  catalogCodes,
  changeProtectingAdministrator,
  plain,
  resolveActor,
  serialized,
} from './role-admin.ts'
import { IAM_ERROR_CODES, RBAC_PERMISSIONS } from 'utils/constants.ts'
import { definedOnly } from 'utils/defined-only.ts'
import { effectiveRoleIds, resolveRolePermissions, storedRoleIds } from 'utils/rbac.ts'

/** How many times a role change re-reads the account when it changed under the request. */
const MAX_WRITE_ATTEMPTS = 3

/** How many holder ids a `ROLE_HAS_HOLDERS` rejection lists. */
const MAX_LISTED_HOLDERS = 20

/** How an account's roles change: add to, remove from, or replace the ones it holds. */
type RolesChange = { mode: 'add' | 'remove' | 'replace'; roleIds: string[] }

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)]

/**
 * Business logic for the `roles` domain — creating/editing/deleting named permission
 * bundles, and assigning them to `auth` accounts. The permission catalog itself (`permissions`)
 * is a sibling domain, `PermissionsService`.
 *
 * Every mutation here is written to the audit trail (`audit.ts`) and follows the two rules of
 * `role-admin.ts`: the caller may only grant or take away permissions it holds NOW
 * (`FORBIDDEN`), and no change may leave the system without an account that can manage roles and
 * sign in (`CONFLICT`). Each rejection carries a stable `code` (`IAM_ERROR_CODES`).
 */
@Interactor()
export class RolesService extends ZanixInteractor {
  /**
   * Loads the permissions `ids` plus `alsoIds` with one query and returns them.
   *
   * @throws {HttpError} `BAD_REQUEST` when any id in `ids` doesn't resolve to a real permission
   *   (an id in `alsoIds` that no longer exists is ignored).
   */
  async #loadPermissions(ids: string[], alsoIds: string[] = []) {
    const wanted = unique([...ids, ...alsoIds])
    if (!wanted.length) return []
    const found = await this.providers.get(PermissionsRepository).findManyByIds(wanted)
    const foundIds = new Set(found.map((permission) => String(permission.id)))
    if (ids.some((id) => !foundIds.has(id))) {
      throw new HttpError('BAD_REQUEST', { message: 'One or more permissions do not exist.' })
    }
    return found
  }

  /** Runs `run` inside the audit trail for the operation `action` on `target`. */
  #audited<T>(
    action: string,
    target: { kind: 'role' | 'account'; id?: string },
    request: unknown,
    run: Parameters<typeof audited<T>>[3],
  ) {
    return audited(this.providers, this.context, { action, target, request }, run)
  }

  /**
   * Creates a new role. `data.tenantId`, when given, scopes the `code` uniqueness check (and the
   * unique index behind it — see `model.defs.ts`) to that tenant only — the same `code` may exist
   * once per tenant, plus once more globally (`tenantId` omitted).
   *
   * @throws {HttpError} `CONFLICT` when a role with the same `code` already exists for the same
   *   `tenantId` (or globally, when `tenantId` is omitted); `BAD_REQUEST` when `data.permissions`
   *   references a permission id that doesn't exist; `FORBIDDEN` (`ROLE_GRANT_EXCEEDS_SCOPE`) when
   *   it includes a permission the caller doesn't hold (only a holder of `*` may create a role
   *   carrying `*`, or a system role).
   */
  public createRole(data: CreateRoleRTO) {
    const permissionIds = unique(data.permissions)
    return this.#audited(
      'roles.create',
      { kind: 'role' },
      { code: data.code, tenantId: data.tenantId, permissions: permissionIds },
      async (note) => {
        const held = await authorizeActor(
          this.providers,
          this.context.session,
          RBAC_PERMISSIONS.roleWrite,
        )
        const existing = await this.providers.get(RolesRepository).findByCode(
          data.code,
          data.tenantId,
        )
        if (existing) {
          throw new HttpError('CONFLICT', {
            message: `A role with code '${data.code}' already exists${
              data.tenantId ? ` for this tenant` : ''
            }.`,
          })
        }
        const permissions = await this.#loadPermissions(permissionIds)
        assertCanGrant(held, catalogCodes(permissions))
        if (data.isSystem) assertCanGrant(held, ['*'])

        const created = await this.providers.get(RolesRepository).createRole({
          name: data.name,
          code: data.code,
          description: data.description,
          tenantId: data.tenantId,
          permissions: permissionIds,
          ...(data.isSystem ? { isSystem: true } : {}),
          createdBy: this.context.session?.subject,
        })
        note({ targetId: String(created.id) })
        return { response: 'role created' }
      },
    )
  }

  /**
   * Edits an existing role by `id`. `code` is immutable — see `EditRoleRTO`. Changing
   * `permissions` adds and takes away permissions, so the caller must hold every one that
   * changes, and the new list must leave an account able to manage roles. When `data.updatedAt`
   * (the version the client read) is sent, the edit applies only if the role is still at that
   * version. A change of permissions is always conditioned on the version it was decided from (the
   * one sent, else the one read), so a concurrent edit makes it fail with `ROLE_VERSION_CONFLICT`
   * to be repeated; an edit of name and description alone, with no version sent, is last-wins.
   *
   * @throws {HttpError} `NOT_FOUND` when no role exists for `id`; `FORBIDDEN` when it is a system
   *   role (`ROLE_IS_SYSTEM`) or the caller doesn't hold a permission that changes
   *   (`ROLE_GRANT_EXCEEDS_SCOPE`); `BAD_REQUEST` when `data.permissions` references a permission
   *   id that doesn't exist; `CONFLICT` when the role changed since `data.updatedAt`
   *   (`ROLE_VERSION_CONFLICT`) or the new list would leave nobody able to manage roles
   *   (`LAST_ADMINISTRATOR`).
   */
  public editRole(id: string, data: EditRoleRTO) {
    const version = data.updatedAt
    const fields = definedOnly({ name: data.name, description: data.description })
    const next = data.permissions && unique(data.permissions)
    return this.#audited(
      'roles.edit',
      { kind: 'role', id },
      { ...fields, permissions: next },
      async (note) => {
        const repository = this.providers.get(RolesRepository)
        // Changing permissions asks for the role catalog (to check an administrator remains); the
        // same read also tells what the caller holds.
        const catalog = next ? await repository.findAllWithPermissions() : undefined
        const held = await authorizeActor(
          this.providers,
          this.context.session,
          RBAC_PERMISSIONS.roleWrite,
          catalog,
        )
        const role = await repository.findById(id)
        if (!role) throw new HttpError('NOT_FOUND', { message: 'Role not found.' })
        this.#assertNotSystem(role)

        const update = { ...fields, ...(next ? { permissions: next } : {}), id }
        let applied: boolean
        if (next) {
          const current = (role.permissions ?? []).map(String)
          note({ before: { permissions: current }, after: { permissions: next } })
          const permissions = await this.#loadPermissions(next, current)
          const changed = new Set([
            ...next.filter((permissionId) => !current.includes(permissionId)),
            ...current.filter((permissionId) => !next.includes(permissionId)),
          ])
          assertCanGrant(
            held,
            catalogCodes(permissions.filter((permission) => changed.has(String(permission.id)))),
          )
          // The permissions are decided from `current` and `catalog`, both read above, so the write
          // is conditioned on the role still being at the version those were read at: the one the
          // client sent, else the one read here. A role without `updatedAt` (documents the schema's
          // timestamps never touched) has no version to condition on and is written as before.
          const ifUpdatedAt = version ? new Date(version) : role.updatedAt
          applied = await changeProtectingAdministrator(
            this.providers,
            {
              kind: 'role-permissions',
              roleId: id,
              permissions: permissions.filter((permission) => next.includes(String(permission.id))),
            },
            {
              write: () => repository.updateRole(update, { ifUpdatedAt }),
              undo: () => repository.replacePermissions(id, next, current),
            },
            catalog,
          )
        } else {
          // Only name and description: nothing was decided from what was read, so without a
          // version the last edit wins.
          applied = await repository.updateRole(update, {
            ifUpdatedAt: version ? new Date(version) : undefined,
          })
        }
        if (!applied) {
          throw new HttpError('CONFLICT', {
            message: 'The role changed after you read it. Read it again and repeat the edit.',
            code: IAM_ERROR_CODES.roleVersionConflict,
          })
        }
        return { response: 'role edited' }
      },
    )
  }

  /**
   * Deletes a role by `id`. A role that accounts still hold is not deleted: the holders must lose
   * it first, so no account is silently left with a dangling role. Taking away a role takes away
   * its permissions, so the caller must hold all of them, and the system must keep an account able
   * to manage roles without it.
   *
   * @throws {HttpError} `NOT_FOUND` when no role exists for `id`; `FORBIDDEN` when it is a system
   *   role (`ROLE_IS_SYSTEM`) or grants a permission the caller doesn't hold
   *   (`ROLE_GRANT_EXCEEDS_SCOPE`); `CONFLICT` when accounts hold it (`ROLE_HAS_HOLDERS`, with
   *   `meta.holderCount` and the first `meta.holderIds`) or it is the last way to manage roles
   *   (`LAST_ADMINISTRATOR`).
   */
  public deleteRole(id: string) {
    return this.#audited('roles.delete', { kind: 'role', id }, undefined, async () => {
      const repository = this.providers.get(RolesRepository)
      const catalog = await repository.findAllWithPermissions()
      const held = await authorizeActor(
        this.providers,
        this.context.session,
        RBAC_PERMISSIONS.roleWrite,
        catalog,
      )
      const role = catalog.find((entry) => String(entry.id) === id)
      if (!role) throw new HttpError('NOT_FOUND', { message: 'Role not found.' })
      this.#assertNotSystem(role)

      assertCanGrant(held, catalogCodes(role.permissions ?? []))

      const holders = await this.providers.get(AuthRepository).findHoldersOfRoleIds([id])
      if (holders.length) {
        throw new HttpError('CONFLICT', {
          message: `The role is held by ${holders.length} account(s). Remove it from them first.`,
          code: IAM_ERROR_CODES.roleHasHolders,
          meta: {
            holderCount: holders.length,
            holderIds: holders.slice(0, MAX_LISTED_HOLDERS).map((holder) => holder.id),
          },
          exposeMeta: true,
        })
      }

      const snapshot = {
        ...plain(role),
        permissions: (role.permissions ?? []).map((permission) => String(plain(permission).id)),
      }
      // A role nobody holds cannot lower the count by itself, and still goes through the same
      // piece: the holders live in another collection, so "nobody holds it" cannot be part of the
      // delete. Between that check and the delete, another request may give this role to the only
      // administrator and take their other role away (each passes its own check because the role
      // still exists); only the count after the delete sees that, and the undo puts the role back.
      await changeProtectingAdministrator(
        this.providers,
        { kind: 'role-deleted', roleId: id },
        {
          write: async () => {
            await repository.deleteRole(id)
            return true
          },
          undo: () => repository.restoreRole(snapshot),
        },
        catalog,
      )
      return { response: 'role deleted' }
    })
  }

  /** Paginated, filterable/searchable listing of roles. `options.tenantId`, when given, is an
   * EXACT filter — see `RolesRepository.searchRoles`'s own doc. */
  public getRoles(options: Partial<SearchRolesRTO> = {}) {
    return this.providers.get(RolesRepository).searchRoles(options)
  }

  /**
   * Gets a role by `id`, with its `permissions` populated, its `updatedAt` (the version to send
   * back when editing) and `holderCount`, how many accounts hold it.
   *
   * @throws {HttpError} `NOT_FOUND` when no role exists for `id`.
   */
  public async getRoleById(id: string) {
    const role = await this.providers.get(RolesRepository).findById(id, { populate: 'permissions' })
    if (!role) throw new HttpError('NOT_FOUND', { message: 'Role not found.' })
    const holderCount = await this.providers.get(AuthRepository).countHolders(id)
    return { ...serialized(role), holderCount }
  }

  /**
   * One page of the people holding the role `id`: `authId`, `userId`, name and status, no contact
   * data, with the total.
   *
   * @throws {HttpError} `NOT_FOUND` when no role exists for `id`.
   */
  public async getRoleHolders(id: string, options: { page?: number; limit?: number } = {}) {
    if (!await this.providers.get(RolesRepository).findById(id)) {
      throw new HttpError('NOT_FOUND', { message: 'Role not found.' })
    }
    const page = await this.providers.get(AuthRepository).searchHolders(id, options)
    const profiles = await this.providers.get(UsersRepository).findManyByIds(
      page.docs.flatMap((holder) => holder.userId ? [holder.userId] : []),
    )
    const byId = new Map(profiles.map((profile) => [String(profile.id), profile]))
    return {
      ...page,
      docs: page.docs.map((holder) => {
        const profile = holder.userId ? byId.get(holder.userId) : undefined
        return {
          authId: holder.id,
          userId: holder.userId,
          firstName: profile?.firstName,
          lastName: profile?.lastName,
          status: profile?.status,
        }
      }),
    }
  }

  /** Throws `FORBIDDEN` (`ROLE_IS_SYSTEM`) when `role` is a system role. */
  #assertNotSystem(role: { isSystem?: boolean }) {
    if (role.isSystem) {
      throw new HttpError('FORBIDDEN', {
        message: 'A system role cannot be edited or deleted.',
        code: IAM_ERROR_CODES.roleIsSystem,
      })
    }
  }

  /**
   * Makes `data.roleId` the ONLY role of the `auth` account `data.authId`: it replaces every role
   * the account holds, as it always has. To keep the roles an account already has (for example
   * the default role given at registration), use {@linkcode addRoles}.
   *
   * Role changes (this method, {@linkcode addRoles}, {@linkcode removeRoles},
   * {@linkcode setRoles}) **do not force a refresh-token revoke.** `@zanix/auth`'s
   * `session.refreshTokens` accepts a `sessionOptions` override on refresh, and
   * `AuthService.refreshTokens` uses it to re-resolve this account's CURRENT permissions (the
   * union over all its roles) on every refresh — see that method's own doc — so a change takes
   * effect on the account's very next refresh, with no forced re-login needed. A forced revoke
   * isn't added as a "why not both" belt-and-braces measure: revoking a refresh token can't
   * invalidate an already-issued, still-live ACCESS token (this project's access tokens are
   * stateless JWTs with no per-request revocation check), so the real security window for a stale
   * permission is bounded by `TOKEN_EXPIRATION` regardless of whether the refresh token is revoked
   * — forcing a revoke here would only add a disruptive full re-login with no compensating
   * security benefit over letting a normal refresh pick up the new roles.
   *
   * Every role change refuses the caller's own account (`FORBIDDEN`, `ROLE_SELF_CHANGE`), a role
   * whose permissions the caller doesn't hold, granted or taken away (`FORBIDDEN`,
   * `ROLE_GRANT_EXCEEDS_SCOPE`), and a result with no account able to manage roles (`CONFLICT`,
   * `LAST_ADMINISTRATOR`, see `role-admin.ts`).
   *
   * @throws {HttpError} `NOT_FOUND` when no role exists for `data.roleId`, or no `auth` account
   *   exists for `data.authId`.
   */
  public async assignRole(data: AssignRoleRTO) {
    await this.#changeRoles('roles.assign', data.authId, {
      mode: 'replace',
      roleIds: [data.roleId],
    })
    return { response: 'role assigned' }
  }

  /**
   * Adds `data.roleIds` to the roles of the `auth` account `data.authId`, after the ones it
   * already holds, atomically (`$addToSet`): a role it already holds is left as it is, so
   * repeating a call changes nothing, and concurrent additions never undo each other. Answers the
   * account's roles afterwards.
   *
   * @throws {HttpError} `NOT_FOUND` when a role or the account does not exist; `FORBIDDEN` when
   *   `data.authId` is the caller's own account or a role grants a permission the caller doesn't
   *   hold.
   */
  public async addRoles(data: AccountRolesRTO) {
    const roleIds = await this.#changeRoles('roles.add', data.authId, {
      mode: 'add',
      roleIds: data.roleIds,
    })
    return { response: 'roles updated', roleIds }
  }

  /**
   * Removes `data.roleIds` from the roles of the `auth` account `data.authId`. A role the account
   * does not hold is ignored. Answers the account's roles afterwards.
   *
   * @throws {HttpError} `NOT_FOUND` when the account does not exist; `FORBIDDEN` when
   *   `data.authId` is the caller's own account or a removed role grants a permission the caller
   *   doesn't hold (a `role-write` holder cannot degrade a more privileged account); `CONFLICT`
   *   when it would leave no account able to manage roles.
   */
  public async removeRoles(data: AccountRolesRTO) {
    const roleIds = await this.#changeRoles('roles.remove', data.authId, {
      mode: 'remove',
      roleIds: data.roleIds,
    })
    return { response: 'roles updated', roleIds }
  }

  /**
   * Sets the roles of the `auth` account `authId` to exactly `requestedRoleIds`, in that order; an
   * empty list removes them all. Answers the account's roles afterwards.
   *
   * @throws {HttpError} `NOT_FOUND` when a role or the account does not exist; `FORBIDDEN` when
   *   `authId` is the caller's own account or a role that changes grants a permission the caller
   *   doesn't hold; `CONFLICT` when it would leave no account able to manage roles.
   */
  public async setRoles(authId: string, requestedRoleIds: string[]) {
    const roleIds = await this.#changeRoles('roles.set', authId, {
      mode: 'replace',
      roleIds: requestedRoleIds,
    })
    return { response: 'roles updated', roleIds }
  }

  /** The role ids of the `auth` account `authId`. @throws {HttpError} `NOT_FOUND` when no account
   * exists for `authId`. */
  public async getAccountRoles(authId: string) {
    const auth = await this.providers.get(AuthRepository).findById(authId)
    if (!auth) throw new HttpError('NOT_FOUND', { message: 'Account not found.' })
    return { authId, roleIds: effectiveRoleIds(auth) }
  }

  /**
   * What the account `authId` can actually do: the permission codes its roles grant today, each
   * with the roles it comes from, resolved with the same `resolveEffectivePermissions` strategy
   * sessions use (a host override included), so a preview cannot differ from the server.
   *
   * @throws {HttpError} `NOT_FOUND` when no account exists for `authId`.
   */
  public async getAccountPermissions(authId: string) {
    const auth = await this.providers.get(AuthRepository).findById(authId)
    if (!auth) throw new HttpError('NOT_FOUND', { message: 'Account not found.' })
    const roleIds = effectiveRoleIds(auth)
    const roles = await this.providers.get(RolesRepository).findManyWithPermissions(roleIds)
    const origins = new Map<string, string[]>()
    for (const role of roles) {
      for (const code of resolveRolePermissions(role)) {
        origins.set(code, [...origins.get(code) ?? [], String(role.id)])
      }
    }
    return {
      authId,
      roleIds,
      permissions: [...origins].map(([code, from]) => ({ code, roles: from })),
    }
  }

  /**
   * Changes the roles of an account after the checks every role change shares, writes it to the
   * audit trail, and returns the roles it holds afterwards.
   *
   * The account is read, the rules are checked against what was read, and the write is conditioned
   * on the account still holding exactly what was read (`replaceRoleIds`/`pullRoleIds`); if it
   * changed in between, the whole step repeats, up to {@linkcode MAX_WRITE_ATTEMPTS} times, and
   * then fails with `ROLE_CONCURRENT_CHANGE`. A removal goes through `changeProtectingAdministrator`
   * (check, write, count again, undo if two requests together removed the last administrator).
   */
  #changeRoles(action: string, authId: string, change: RolesChange): Promise<string[]> {
    return this.#audited(action, { kind: 'account', id: authId }, change, async (note) => {
      const actor = await resolveActor(this.providers, this.context.session)
      // Business rule with no native guard: `@zanix/auth` offers none for "not on yourself".
      // `session.subject` is the `auth` id `AuthService` embeds at sign-in
      // (`generateTokens({ subject: auth.id })`), the same id `authId` names here.
      if (this.context.session?.subject === authId) {
        throw new HttpError('FORBIDDEN', {
          message: 'You cannot change your own roles.',
          code: IAM_ERROR_CODES.roleSelfChange,
        })
      }
      const repository = this.providers.get(AuthRepository)

      for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
        // deno-lint-ignore no-await-in-loop
        const auth = await repository.findById(authId)
        if (!auth) throw new HttpError('NOT_FOUND', { message: 'Account not found.' })

        const current = effectiveRoleIds(auth)
        const next = this.#nextRoles(current, change)
        const granted = next.filter((id) => !current.includes(id))
        const removed = current.filter((id) => !next.includes(id))
        note({ before: { roleIds: current }, after: { roleIds: next } })

        // One query for the roles being changed and the ones the caller holds.
        // deno-lint-ignore no-await-in-loop
        const roles = await this.providers.get(RolesRepository).findManyWithPermissions(
          unique([...actor.roleIds, ...granted, ...removed]),
        )
        const held = actorHeld(actor, roles)
        assertActorHolds(held, RBAC_PERMISSIONS.roleWrite)
        if (!granted.length && !removed.length) return current
        if (granted.some((id) => !roles.some((role) => String(role.id) === id))) {
          throw new HttpError('NOT_FOUND', { message: 'Role not found.' })
        }
        assertCanGrant(
          held,
          roles.filter((role) => [...granted, ...removed].includes(String(role.id)))
            .flatMap((role) => resolveRolePermissions(role)),
        )

        // deno-lint-ignore no-await-in-loop
        const written = await this.#apply(authId, auth, change, next)
        if (!written) continue

        // `add` is not conditioned on what was read, so what it holds now is read back.
        // deno-lint-ignore no-await-in-loop
        return change.mode === 'add' ? effectiveRoleIds(await repository.findById(authId)) : next
      }
      throw new HttpError('CONFLICT', {
        message: 'The roles of this account changed while the request ran. Try again.',
        code: IAM_ERROR_CODES.roleConcurrentChange,
      })
    })
  }

  /**
   * Writes the new roles of an account. A change that takes roles away goes through
   * `changeProtectingAdministrator` (check, write, count again, undo if two requests together
   * removed the last administrator); one that only adds writes directly. `false` means the account
   * changed since it was read and nothing was written.
   *
   * The conditional writes compare against the roles exactly as stored (`storedRoleIds`), repeats
   * included: a document that stores a role twice would never match a de-duplicated copy of
   * itself, and every change to it would end in `ROLE_CONCURRENT_CHANGE`.
   */
  #apply(
    authId: string,
    auth: { userId?: unknown; roleIds?: readonly unknown[] | null },
    change: RolesChange,
    next: string[],
  ): Promise<boolean> {
    const stored = storedRoleIds(auth)
    const removed = effectiveRoleIds(auth).filter((id) => !next.includes(id))
    const repository = this.providers.get(AuthRepository)
    const write = async () => {
      if (change.mode === 'add') {
        await repository.addRoleIds(authId, next.filter((id) => !stored.includes(id)))
        return true
      }
      if (change.mode === 'remove') return await repository.pullRoleIds(authId, stored, removed)
      return await repository.replaceRoleIds(authId, stored, next)
    }
    if (!removed.length) return write()
    // What the write leaves stored, to undo it only if nothing else changed the account since.
    const written = change.mode === 'remove' ? stored.filter((id) => !removed.includes(id)) : next
    return changeProtectingAdministrator(
      this.providers,
      {
        kind: 'account-roles',
        authId,
        userId: auth.userId ? String(auth.userId) : undefined,
        roleIds: next,
      },
      { write, undo: () => repository.replaceRoleIds(authId, written, stored) },
    )
  }

  /** The roles `change` leaves an account holding, from `current`, without repeats. */
  #nextRoles(current: string[], change: RolesChange): string[] {
    const requested = unique(change.roleIds)
    if (change.mode === 'add') return unique([...current, ...requested])
    if (change.mode === 'remove') return current.filter((id) => !requested.includes(id))
    return requested
  }
}
