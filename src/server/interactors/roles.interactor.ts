import type {
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

/**
 * Business logic for the `roles` domain slice — creating/editing/deleting named permission
 * bundles, and assigning one to an `auth` account. The permission catalog itself (`permissions`)
 * is a sibling slice, `PermissionsService` — this service only ever validates that a role's own
 * referenced permission ids exist, via `PermissionsRepository`.
 */
@Interactor()
export class RolesService extends ZanixInteractor {
  /** Throws `BAD_REQUEST` when any id in `permissions` doesn't resolve to a real permission. */
  async #assertPermissionsExist(permissions: string[]) {
    if (!permissions.length) return
    const existing = await this.providers.get(PermissionsRepository).findManyByIds(permissions)
    if (existing.length !== new Set(permissions).size) {
      throw new HttpError('BAD_REQUEST', { message: 'One or more permissions do not exist.' })
    }
  }

  /**
   * Creates a new role. `data.tenantId`, when given, scopes the `code` uniqueness check (and the
   * unique index behind it — see `model.defs.ts`) to that tenant only — the same `code` may exist
   * once per tenant, plus once more globally (`tenantId` omitted).
   *
   * @throws {HttpError} `CONFLICT` when a role with the same `code` already exists for the same
   *   `tenantId` (or globally, when `tenantId` is omitted); `BAD_REQUEST` when `data.permissions`
   *   references a permission id that doesn't exist.
   */
  public async createRole(data: CreateRoleRTO) {
    const existing = await this.providers.get(RolesRepository).findByCode(data.code, data.tenantId)
    if (existing) {
      throw new HttpError('CONFLICT', {
        message: `A role with code '${data.code}' already exists${
          data.tenantId ? ` for this tenant` : ''
        }.`,
      })
    }
    await this.#assertPermissionsExist(data.permissions)

    await this.providers.get(RolesRepository).createRole({
      name: data.name,
      code: data.code,
      description: data.description,
      tenantId: data.tenantId,
      permissions: data.permissions,
      createdBy: this.context.session?.subject,
    })
    return { response: 'role created' }
  }

  /**
   * Edits an existing role by `id`. `code` is immutable — see `EditRoleRTO`.
   *
   * @throws {HttpError} `NOT_FOUND` when no role exists for `id`; `BAD_REQUEST` when
   *   `data.permissions` references a permission id that doesn't exist.
   */
  public async editRole(id: string, data: EditRoleRTO) {
    const role = await this.providers.get(RolesRepository).findById(id)
    if (!role) throw new HttpError('NOT_FOUND', { message: 'Role not found.' })
    if (data.permissions) await this.#assertPermissionsExist(data.permissions)

    await this.providers.get(RolesRepository).updateRole({ ...data, id })
    return { response: 'role edited' }
  }

  /** Deletes a role by `id`. @throws {HttpError} `NOT_FOUND` when no role exists for `id`. */
  public async deleteRole(id: string) {
    const role = await this.providers.get(RolesRepository).findById(id)
    if (!role) throw new HttpError('NOT_FOUND', { message: 'Role not found.' })

    await this.providers.get(RolesRepository).deleteRole(id)
    return { response: 'role deleted' }
  }

  /** Paginated, filterable/searchable listing of roles. `options.tenantId`, when given, is an
   * EXACT filter — see `RolesRepository.searchRoles`'s own doc. */
  public getRoles(options: Partial<SearchRolesRTO> = {}) {
    return this.providers.get(RolesRepository).searchRoles(options)
  }

  /** Gets a role by `id`, with its `permissions` populated. @throws {HttpError} `NOT_FOUND` when
   * no role exists for `id`. */
  public async getRoleById(id: string) {
    const role = await this.providers.get(RolesRepository).findById(id, { populate: 'permissions' })
    if (!role) throw new HttpError('NOT_FOUND', { message: 'Role not found.' })
    return role
  }

  /**
   * Assigns `data.roleId` to the `auth` account `data.authId`.
   *
   * **Does not force a refresh-token revoke on reassignment.** `@zanix/auth`'s `session.refreshTokens`
   * accepts a `sessionOptions` override on refresh, and `AuthService.refreshTokens` uses it to
   * re-resolve this account's CURRENT permissions on every refresh — see that method's own doc —
   * so a role reassignment already takes effect on the account's very next refresh, with no forced
   * re-login needed. A forced revoke isn't added as a "why not both" belt-and-braces measure:
   * revoking a refresh token can't invalidate an already-issued, still-live ACCESS token (this
   * project's access tokens are stateless JWTs with no per-request revocation check), so the real
   * security window for a stale permission is bounded by `TOKEN_EXPIRATION` regardless of whether
   * the refresh token is revoked — forcing a revoke here would only add a disruptive full re-login
   * with no compensating security benefit over letting a normal refresh pick up the new role.
   *
   * @throws {HttpError} `NOT_FOUND` when no role exists for `data.roleId`, or no `auth` account
   *   exists for `data.authId`.
   */
  public async assignRole(data: AssignRoleRTO) {
    const role = await this.providers.get(RolesRepository).findById(data.roleId)
    if (!role) throw new HttpError('NOT_FOUND', { message: 'Role not found.' })

    const auth = await this.providers.get(AuthRepository).findById(data.authId)
    if (!auth) throw new HttpError('NOT_FOUND', { message: 'Account not found.' })

    await this.providers.get(AuthRepository).updateAuth({ id: data.authId, roleId: data.roleId })

    return { response: 'role assigned' }
  }
}
