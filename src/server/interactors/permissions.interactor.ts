import type {
  CreatePermissionRTO,
  EditPermissionRTO,
  SearchPermissionsRTO,
} from '../handlers/rtos/permissions.ts'

import { HttpError } from '@zanix/errors'
import { Interactor, ZanixInteractor } from '@zanix/server'
import { PermissionsRepository } from '../repositories/permissions/entity.provider.ts'

/**
 * Business logic for the `permissions` domain slice — managing the flat permission-code catalog
 * `roles` documents reference. See `PermissionsRepository`/`model.defs.ts` for the reserved `'*'`
 * wildcard code.
 */
@Interactor()
export class PermissionsService extends ZanixInteractor {
  /**
   * Creates a new permission. @throws {HttpError} `CONFLICT` when a permission with the same
   * `code` already exists.
   */
  public async createPermission(data: CreatePermissionRTO) {
    const existing = await this.providers.get(PermissionsRepository).findByCode(data.code)
    if (existing) {
      throw new HttpError('CONFLICT', {
        message: `A permission with code '${data.code}' already exists.`,
      })
    }

    await this.providers.get(PermissionsRepository).createPermission({
      code: data.code,
      name: data.name,
      description: data.description,
      categories: data.categories,
      isActive: data.isActive,
      createdBy: this.context.session?.subject,
    })
    return { response: 'permission created' }
  }

  /**
   * Edits an existing permission by `id`. `code` is immutable — see `EditPermissionRTO`.
   * @throws {HttpError} `NOT_FOUND` when no permission exists for `id`.
   */
  public async editPermission(id: string, data: EditPermissionRTO) {
    const permission = await this.providers.get(PermissionsRepository).findById(id)
    if (!permission) throw new HttpError('NOT_FOUND', { message: 'Permission not found.' })

    await this.providers.get(PermissionsRepository).updatePermission({ ...data, id })
    return { response: 'permission edited' }
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
