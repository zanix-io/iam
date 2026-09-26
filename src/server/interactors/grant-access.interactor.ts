import type {
  CheckGrantAccessRTO,
  CreateGrantAccessRTO,
  EditGrantAccessRTO,
  SearchGrantAccessRTO,
} from '../handlers/rtos/grant-access.ts'
import type { GrantAccessDoc } from 'utils/grant-access.ts'

import { HttpError } from '@zanix/errors'
import { Interactor, ZanixInteractor } from '@zanix/server'
import { resolveBehavior } from '@zanix/app/runtime'
import { GrantAccessRepository } from '../repositories/grant-access/entity.provider.ts'
import { defaultEvaluateGrantAccess } from 'utils/grant-access.ts'

/**
 * Business logic for the `grant-access` domain — fine-grained, per-resource access grants,
 * independent from the `roles`/`permissions` RBAC catalog (see `model.defs.ts`'s own doc for the
 * distinction). Its own admin CRUD endpoints are gated by the ordinary
 * `RBAC_PERMISSIONS.grantAccessRead`/`grantAccessWrite` `AuthTokenValidation` mechanism (see
 * `GrantAccessController`) rather than a separate, hand-rolled role check — reusing the
 * general-purpose RBAC catalog avoids a second, parallel authorization mechanism for the same
 * kind of decision.
 */
@Interactor()
export class GrantAccessService extends ZanixInteractor {
  /**
   * Creates a new grant. `data.tenantId`, when given, scopes the `{userId, resourceId, tenantId}`
   * uniqueness check (and the unique index behind it — see `model.defs.ts`) to that tenant only.
   *
   * A collision throws `CONFLICT` rather than returning the existing grant (no idempotent
   * find-or-create), matching `RolesService.createRole`/`PermissionsService.createPermission`: a
   * duplicate is a caller error to surface, not to paper over.
   *
   * @throws {HttpError} `CONFLICT` when a grant already exists for the same
   *   `{userId, resourceId, tenantId}` tuple.
   */
  public async createGrant(data: CreateGrantAccessRTO) {
    const existing = await this.providers.get(GrantAccessRepository).findOne(
      data.userId,
      data.resourceId,
      data.tenantId,
    )
    if (existing) {
      throw new HttpError('CONFLICT', {
        message: `A grant already exists for this user/resource${
          data.tenantId ? ' within this tenant' : ''
        }.`,
      })
    }

    await this.providers.get(GrantAccessRepository).createGrant({
      userId: data.userId,
      resourceId: data.resourceId,
      tenantId: data.tenantId,
      accessLevel: data.accessLevel,
      expiresAt: data.expiresAt,
      isActive: data.isActive,
      grantedBy: this.context.session?.subject as string,
    })
    return { response: 'grant created' }
  }

  /**
   * Edits an existing grant by `id`. `userId`/`resourceId`/`tenantId` are immutable — see
   * `EditGrantAccessRTO`'s own doc.
   *
   * @throws {HttpError} `NOT_FOUND` when no grant exists for `id`.
   */
  public async editGrant(id: string, data: EditGrantAccessRTO) {
    const grant = await this.providers.get(GrantAccessRepository).findById(id)
    if (!grant) throw new HttpError('NOT_FOUND', { message: 'Grant not found.' })

    await this.providers.get(GrantAccessRepository).updateGrant({ ...data, id })
    return { response: 'grant edited' }
  }

  /**
   * Revokes (deletes) a grant by `id`.
   *
   * Checks existence first, the same way `RolesService.deleteRole` does, so revoking an
   * already-revoked/never-existing grant reports `NOT_FOUND` instead of silent success.
   *
   * @throws {HttpError} `NOT_FOUND` when no grant exists for `id`.
   */
  public async revokeGrant(id: string) {
    const grant = await this.providers.get(GrantAccessRepository).findById(id)
    if (!grant) throw new HttpError('NOT_FOUND', { message: 'Grant not found.' })

    await this.providers.get(GrantAccessRepository).deleteGrant(id)
    return { response: 'grant revoked' }
  }

  /** Paginated, filterable listing of grants. `options.tenantId`, when given, is an EXACT filter
   * — see `GrantAccessRepository.searchGrants`'s own doc. */
  public getGrants(options: Partial<SearchGrantAccessRTO> = {}) {
    return this.providers.get(GrantAccessRepository).searchGrants(options)
  }

  /** Gets a grant by `id`. @throws {HttpError} `NOT_FOUND` when no grant exists for `id`. */
  public async getGrantById(id: string) {
    const grant = await this.providers.get(GrantAccessRepository).findById(id)
    if (!grant) throw new HttpError('NOT_FOUND', { message: 'Grant not found.' })
    return grant
  }

  /**
   * Does `data.userId` have at-least-`data.accessLevel` access to `data.resourceId` (optionally
   * within `data.tenantId`)? Looks up the grant for that exact tuple, then delegates the actual
   * evaluation to `grant-access.app.ts`'s own `evaluateGrantAccess` behavior, falling back to its
   * default (`utils/grant-access.ts`'s own `defaultEvaluateGrantAccess`) when no host override is
   * registered or no app was ever activated (e.g. this class's own unit tests) — same
   * "override, else default" precedence `auth.app.ts`'s own `resolveEffectivePermissions` call
   * site already follows (`AuthService.resolveSessionPermissions`).
   *
   * Callable two ways: directly, as a plain admin-gated `GET /grant-access/check` endpoint
   * (`GrantAccessController`); and as `grant-access.app.ts`'s own `checkAccess` operation, so
   * ANOTHER `@zanix/app`-composed service can ask this question about ITS OWN caller without this
   * project ever knowing what that other service's resources look like — see that manifest's own
   * doc for why this lives on a Zanix App at all.
   *
   * Returns `{ allowed: false }` rather than throwing when no grant exists at all — the "no access"
   * case is a normal, expected outcome here, never an error condition.
   */
  public async checkAccess(data: CheckGrantAccessRTO): Promise<{ allowed: boolean }> {
    const grant = await this.providers.get(GrantAccessRepository).findOne(
      data.userId,
      data.resourceId,
      data.tenantId,
    ) as GrantAccessDoc

    const strategy = resolveBehavior<(grant: GrantAccessDoc, requiredLevel: string) => boolean>(
      'grant-access',
      'evaluateGrantAccess',
    ) ?? defaultEvaluateGrantAccess

    return { allowed: strategy(grant, data.accessLevel) }
  }
}
