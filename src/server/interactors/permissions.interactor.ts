import type {
  CreatePermissionRTO,
  EditPermissionRTO,
  SearchPermissionsRTO,
} from '../handlers/rtos/permissions.ts'

import { HttpError } from '@zanix/errors'
import { Interactor, ZanixInteractor } from '@zanix/server'
import { audited } from './audit.ts'
import { assertCanGrant, authorizeActor, changeProtectingAdministrator } from './role-admin.ts'
import { IAM_ERROR_CODES, RBAC_PERMISSIONS } from 'utils/constants.ts'
import { definedOnly } from 'utils/defined-only.ts'
import { PermissionsRepository } from '../repositories/permissions/entity.provider.ts'
import { RolesRepository } from '../repositories/roles/entity.provider.ts'

/**
 * Business logic for the `permissions` domain — managing the flat permission-code catalog
 * `roles` documents reference. See `PermissionsRepository`/`model.defs.ts` for the reserved `'*'`
 * wildcard code.
 */
@Interactor()
export class PermissionsService extends ZanixInteractor {
  /**
   * Creates a new permission. The caller must still hold `permission-write` in the database, not
   * only in its token (`ACTOR_LACKS_PERMISSION`); the attempt, accepted or refused, is audited.
   *
   * @throws {HttpError} `CONFLICT` when a permission with the same `code` already exists;
   *   `FORBIDDEN` as above.
   */
  public createPermission(data: CreatePermissionRTO) {
    return audited(
      this.providers,
      this.context,
      {
        action: 'permissions.create',
        target: { kind: 'permission' },
        request: { code: data.code, isActive: data.isActive },
      },
      async (note) => {
        await authorizeActor(this.providers, this.context.session, RBAC_PERMISSIONS.permissionWrite)
        const existing = await this.providers.get(PermissionsRepository).findByCode(data.code)
        if (existing) {
          throw new HttpError('CONFLICT', {
            message: `A permission with code '${data.code}' already exists.`,
          })
        }

        const created = await this.providers.get(PermissionsRepository).createPermission({
          code: data.code,
          name: data.name,
          description: data.description,
          categories: data.categories,
          isActive: data.isActive,
          createdBy: this.context.session?.subject,
        })
        note({ targetId: String(created.id) })
        return { response: 'permission created' }
      },
    )
  }

  /**
   * Edits an existing permission by `id`. `code` is immutable — see `EditPermissionRTO`. The
   * caller must still hold `permission-write` in the database (`ACTOR_LACKS_PERMISSION`).
   * Turning the permission on or off (`isActive`) grants or takes it away from every role that
   * carries it, so the caller must hold it, and turning it off must leave an account able to
   * manage roles. When `data.updatedAt` (the version the client read) is sent, the edit applies
   * only if the permission is still at that version.
   *
   * @throws {HttpError} `NOT_FOUND` when no permission exists for `id`; `FORBIDDEN`
   *   (`ROLE_GRANT_EXCEEDS_SCOPE`) when the caller doesn't hold it and changes `isActive`;
   *   `CONFLICT` when it changed since `data.updatedAt` (`PERMISSION_VERSION_CONFLICT`) or
   *   deactivating it would leave nobody able to manage roles (`LAST_ADMINISTRATOR`).
   */
  public editPermission(id: string, data: EditPermissionRTO) {
    const version = data.updatedAt
    const fields = definedOnly({
      name: data.name,
      description: data.description,
      categories: data.categories,
      isActive: data.isActive,
    })
    return audited(
      this.providers,
      this.context,
      { action: 'permissions.edit', target: { kind: 'permission', id }, request: fields },
      async (note) => {
        // Deactivating asks for the role catalog (to check an administrator remains); the same read
        // also tells what the caller holds.
        const catalog = fields.isActive === false
          ? await this.providers.get(RolesRepository).findAllWithPermissions()
          : undefined
        const held = await authorizeActor(
          this.providers,
          this.context.session,
          RBAC_PERMISSIONS.permissionWrite,
          catalog,
        )
        const repository = this.providers.get(PermissionsRepository)
        const permission = await repository.findById(id)
        if (!permission) throw new HttpError('NOT_FOUND', { message: 'Permission not found.' })

        const ifUpdatedAt = version ? new Date(version) : undefined
        const update = { ...fields, id }
        // Turning a permission on or off grants or takes it away from every role that carries it.
        const toggled = fields.isActive !== undefined && fields.isActive !== permission.isActive
        if (toggled) {
          note({ before: { isActive: permission.isActive }, after: { isActive: fields.isActive } })
          assertCanGrant(held, [permission.code])
        }
        const applied = toggled && fields.isActive === false
          ? await changeProtectingAdministrator(
            this.providers,
            { kind: 'permission-deactivated', permissionId: id },
            {
              write: () => repository.updatePermission(update, { ifUpdatedAt }),
              undo: () => repository.restoreActive(id, false, true),
            },
            catalog,
          )
          : await repository.updatePermission(update, { ifUpdatedAt })
        if (!applied) {
          throw new HttpError('CONFLICT', {
            message: 'The permission changed after you read it. Read it again and repeat the edit.',
            code: IAM_ERROR_CODES.permissionVersionConflict,
          })
        }
        return { response: 'permission edited' }
      },
    )
  }

  /** Paginated, filterable/searchable listing of the permission catalog. */
  public getPermissions(options: Partial<SearchPermissionsRTO> = {}) {
    return this.providers.get(PermissionsRepository).searchPermissions(options)
  }

  /** Gets a permission by `id`. @throws {HttpError} `NOT_FOUND` when no permission exists for
   * `id`. */
  public async getPermissionById(id: string) {
    const permission = await this.providers.get(PermissionsRepository).findById(id)
    if (!permission) throw new HttpError('NOT_FOUND', { message: 'Permission not found.' })
    return permission
  }
}
