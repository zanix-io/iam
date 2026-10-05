import type { ZanixMongoConnector } from '@zanix/datamaster'
import type { PermissionsAttrs } from './model.defs.ts'

import { Provider, ZanixProvider } from '@zanix/server'
import { definedOnly } from 'utils/defined-only.ts'

/**
 * Provider for the `permissions` model — the flat permission-code catalog `roles` documents
 * reference. See `model.defs.ts` for the reserved `'*'` wildcard code.
 *
 * @class
 * @extends ZanixProvider
 */
@Provider()
export class PermissionsRepository extends ZanixProvider<{ database: ZanixMongoConnector }> {
  /** The Mongoose model bound to the `permissions` collection. */
  private Model
  constructor() {
    super()
    this.Model = this.database.getModel<PermissionsAttrs>('permissions')
  }

  /** Creates a new permission. `isActive` defaults to `true` when omitted. */
  public createPermission(data: Partial<PermissionsAttrs> & { code: string; name: string }) {
    const doc = new this.Model(data)
    return doc.save()
  }

  /** Finds a permission by its own `id`. */
  public findById(id?: string) {
    if (!id) return undefined
    return this.Model.findById(id).exec()
  }

  /** Finds a permission by its unique `code`. */
  public findByCode(code: string) {
    return this.Model.findOne({ code }).exec()
  }

  /** Finds every permission whose `id` is in `ids` — used to validate a role's own `permissions`
   * references before persisting it (see `RolesService`). */
  public findManyByIds(ids: string[]) {
    if (!ids.length) return Promise.resolve([])
    return this.Model.find({ _id: { $in: ids } }).exec()
  }

  /**
   * Updates an existing permission. With `options.ifUpdatedAt` the write happens only if the
   * permission's `updatedAt` is still that instant (optimistic version check); answers whether it
   * matched.
   * ⚠️ Ensure that only existing records are updated, or validate their existence before
   * performing the update.
   *
   * @param data Fields to update — must include `id`.
   */
  public async updatePermission(
    data: Partial<PermissionsAttrs> & { id: string },
    options: { ifUpdatedAt?: Date } = {},
  ) {
    const { id, ...rest } = data
    const filter = options.ifUpdatedAt ? { _id: id, updatedAt: options.ifUpdatedAt } : { _id: id }
    const result = await this.Model.updateOne(filter, { $set: definedOnly(rest) }).exec()
    return result.matchedCount > 0
  }

  /**
   * Sets a permission's `isActive` to `previous` only if it is still `expected`; the undo of a
   * deactivation that left nobody able to manage roles. Answers whether it matched.
   */
  public async restoreActive(id: string, expected: boolean, previous: boolean) {
    const result = await this.Model.updateOne(
      { _id: id, isActive: expected },
      { $set: { isActive: previous } },
    ).exec()
    return result.matchedCount > 0
  }

  /** Paginated, filterable/searchable listing of the permission catalog. `query` matches across
   * `name`/`code`. */
  public searchPermissions(
    options: {
      query?: string
      page?: number
      limit?: number
      sortBy?: Record<string, 1 | -1>
    } = {},
  ) {
    const { query, limit, page, sortBy: sort } = options
    return this.Model.paginate({
      page,
      limit,
      sort,
      search: { query, fields: ['name', 'code'] },
    })
  }
}
