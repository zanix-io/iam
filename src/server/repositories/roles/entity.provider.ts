import type { ZanixMongoConnector } from '@zanix/datamaster'
import type { RolesAttrs } from './model.defs.ts'

import { Provider, ZanixProvider } from '@zanix/server'

/**
 * Provider for the `roles` model — named permission bundles assignable to an `auth` account. See
 * `model.defs.ts` for the optional `tenantId` scoping this project supports.
 *
 * Decorated with an explicit `'rolesRepository'` slot for the same reason as `AuthRepository`
 * (see that class's own doc): `AuthService.resolveSessionPermissions`/
 * `PasswordService.resolveSessionPermissions` reach this class from Space pages bound via
 * `@Page({ Interactor: ... })`, and Vite's SSR pipeline re-evaluates this file into a second class
 * object independent of the one `zanix space dev`'s native process loaded at boot. The named slot
 * resolves both evaluations to the same cached singleton instead of splitting into two, avoiding
 * the class-identity lookup failure a plain `@Provider()` would hit here.
 *
 * @class
 * @extends ZanixProvider
 */
@Provider('rolesRepository')
export class RolesRepository extends ZanixProvider<{ database: ZanixMongoConnector }> {
  /** The Mongoose model bound to the `roles` collection. */
  private Model
  constructor() {
    super()
    this.Model = this.database.getModel<RolesAttrs>('roles')
  }

  /** Creates a new role. */
  public createRole(
    data: Partial<RolesAttrs> & { name: string; code: string; description: string },
  ) {
    const doc = new this.Model(data)
    return doc.save()
  }

  /** Finds a role by its own `id`, optionally populating a ref path (e.g. `'permissions'`). */
  public findById(id?: string, options: { populate?: string } = {}) {
    if (!id) return undefined
    const query = this.Model.findById(id)
    return options.populate ? query.populate(options.populate).exec() : query.exec()
  }

  /**
   * Finds a role by its `code`, scoped to `tenantId` — the exact tuple the `{code, tenantId}`
   * unique index enforces. Omitting `tenantId` looks up the GLOBAL role for that `code` only
   * (`tenantId` absent, i.e. `$exists: false`), never any tenant-scoped one — a plain `{ code }`
   * filter with `tenantId` left out of the object would otherwise match ANY tenant's role of that
   * code too, defeating the collision check this backs (`RolesService.createRole`).
   */
  public findByCode(code: string, tenantId?: string) {
    const filter = tenantId ? { code, tenantId } : { code, tenantId: { $exists: false } }
    return this.Model.findOne(filter).exec()
  }

  /**
   * Updates an existing role.
   * ⚠️ Ensure that only existing records are updated, or validate their existence before
   * performing the update.
   *
   * @param data Fields to update — must include `id`.
   */
  public updateRole(data: Partial<RolesAttrs> & { id: string }) {
    const { id, ...rest } = data
    return this.Model.updateOne({ _id: id }, { $set: rest }).exec()
  }

  /** Deletes a role by `id`. */
  public deleteRole(id: string) {
    return this.Model.deleteOne({ _id: id }).exec()
  }

  /**
   * Paginated, filterable/searchable listing of roles. `query` matches across `name`/`code`.
   * `tenantId`, when given, is an EXACT filter — only that tenant's own roles, never merged with
   * the global (`tenantId`-absent) catalog. Omit it to list every role regardless of tenant.
   */
  public searchRoles(
    options: {
      query?: string
      tenantId?: string
      page?: number
      limit?: number
      sortBy?: Record<string, 1 | -1>
    } = {},
  ) {
    const { query, tenantId, limit, page, sortBy: sort } = options
    return this.Model.paginate({
      page,
      limit,
      sort,
      filter: tenantId ? { tenantId } : undefined,
      search: { query, fields: ['name', 'code'] },
    })
  }
}
