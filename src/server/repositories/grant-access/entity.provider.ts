import type { ZanixMongoConnector } from '@zanix/datamaster'
import type { GrantAccessAttrs } from './model.defs.ts'

import { Provider, ZanixProvider } from '@zanix/server'

/**
 * Provider for the `grant_accesses` model — fine-grained, per-resource access grants. See
 * `model.defs.ts` for the full shape and its deliberate deviations from this domain slice's own
 * grounding reference.
 *
 * @class
 * @extends ZanixProvider
 */
@Provider()
export class GrantAccessRepository extends ZanixProvider<{ database: ZanixMongoConnector }> {
  /** The Mongoose model bound to the `grant_accesses` collection. */
  private Model
  constructor() {
    super()
    this.Model = this.database.getModel<GrantAccessAttrs>('grant_accesses')
  }

  /** Creates a new grant. */
  public createGrant(
    data:
      & Partial<GrantAccessAttrs>
      & { userId: string; resourceId: string; accessLevel: string; grantedBy: string },
  ) {
    const doc = new this.Model(data)
    return doc.save()
  }

  /** Finds a grant by its own `id`. */
  public findById(id?: string) {
    if (!id) return undefined
    return this.Model.findById(id).exec()
  }

  /**
   * Finds the grant for the exact `{userId, resourceId, tenantId}` tuple the unique index
   * enforces. Omitting `tenantId` looks up the GLOBAL grant for that user/resource pair only
   * (`tenantId` absent, i.e. `$exists: false`) — same reasoning as `RolesRepository.findByCode`'s
   * own doc (`../roles/entity.provider.ts`), applied here to grants.
   */
  public findOne(userId: string, resourceId: string, tenantId?: string) {
    const filter = tenantId
      ? { userId, resourceId, tenantId }
      : { userId, resourceId, tenantId: { $exists: false } }
    return this.Model.findOne(filter).exec()
  }

  /**
   * Updates an existing grant.
   * ⚠️ Ensure that only existing records are updated, or validate their existence before
   * performing the update.
   *
   * @param data Fields to update — must include `id`.
   */
  public updateGrant(data: Partial<GrantAccessAttrs> & { id: string }) {
    const { id, ...rest } = data
    return this.Model.updateOne({ _id: id }, { $set: rest }).exec()
  }

  /** Deletes (revokes) a grant by `id`. */
  public deleteGrant(id: string) {
    return this.Model.deleteOne({ _id: id }).exec()
  }

  /**
   * Paginated, filterable listing of grants. `userId`/`resourceId`/`tenantId`, when given, are
   * EXACT filters — `tenantId` never merges with the global (`tenantId`-absent) catalog, same
   * reasoning as `RolesRepository.searchRoles`'s own doc.
   */
  public searchGrants(
    options: {
      userId?: string
      resourceId?: string
      tenantId?: string
      page?: number
      limit?: number
      sortBy?: Record<string, 1 | -1>
    } = {},
  ) {
    const { userId, resourceId, tenantId, limit, page, sortBy: sort } = options
    const filter: Record<string, unknown> = {}
    if (userId) filter.userId = userId
    if (resourceId) filter.resourceId = resourceId
    if (tenantId) filter.tenantId = tenantId
    return this.Model.paginate({ page, limit, sort, filter })
  }
}
