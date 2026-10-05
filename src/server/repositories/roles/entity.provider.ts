import type { ZanixMongoConnector } from '@zanix/datamaster'
import type { PopulatedRoleDoc } from 'utils/rbac.ts'
import type { RolesAttrs } from './model.defs.ts'

import { Provider, ZanixProvider } from '@zanix/server'
import { definedOnly } from 'utils/defined-only.ts'

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
   * Finds the roles whose id is in `ids` with ONE query. A missing id is simply absent from the
   * answer, and the answer's order is not the order of `ids`.
   */
  public findManyByIds(ids: string[]) {
    if (!ids.length) return Promise.resolve([])
    return this.Model.find({ _id: { $in: ids } }).exec()
  }

  /** Like {@linkcode findManyByIds}, with each role's `permissions` populated. */
  public findManyWithPermissions(ids: string[]): Promise<PopulatedRoleDoc[]> {
    if (!ids.length) return Promise.resolve([])
    return this.#populated({ _id: { $in: ids } })
  }

  /** Every role with its `permissions` populated. */
  public findAllWithPermissions(): Promise<PopulatedRoleDoc[]> {
    return this.#populated({})
  }

  /** `populate` types `permissions` as the ref ids; the query returns the permission documents. */
  async #populated(filter: Record<string, unknown>): Promise<PopulatedRoleDoc[]> {
    return await this.Model.find(filter).populate('permissions')
      .exec() as unknown as PopulatedRoleDoc[]
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
   * Updates an existing role. With `options.ifUpdatedAt` the write happens only if the role's
   * `updatedAt` is still that instant (optimistic version check); answers whether it matched.
   * ⚠️ Ensure that only existing records are updated, or validate their existence before
   * performing the update.
   *
   * @param data Fields to update — must include `id`.
   */
  public async updateRole(
    data: Partial<RolesAttrs> & { id: string },
    options: { ifUpdatedAt?: Date } = {},
  ) {
    const { id, ...rest } = data
    const filter = options.ifUpdatedAt ? { _id: id, updatedAt: options.ifUpdatedAt } : { _id: id }
    const result = await this.Model.updateOne(filter, { $set: definedOnly(rest) }).exec()
    return result.matchedCount > 0
  }

  /**
   * Replaces a role's `permissions` with `next` only if they are still exactly `expected`; the
   * undo of an edit that left nobody able to manage roles. Answers whether it matched.
   */
  public async replacePermissions(roleId: string, expected: string[], next: string[]) {
    const result = await this.Model.updateOne(
      { _id: roleId, permissions: expected },
      { $set: { permissions: next } },
    ).exec()
    return result.matchedCount > 0
  }

  /**
   * Puts a deleted role back with the same id, if no role has that id; the undo of a delete.
   * `snapshot` is the role as it was read, `id` included.
   */
  public async restoreRole(snapshot: Partial<RolesAttrs> & { id: string }) {
    const { id, createdAt: _createdAt, updatedAt: _updatedAt, ...fields } = snapshot
    const result = await this.Model.updateOne(
      { _id: id },
      { $setOnInsert: fields },
      { upsert: true },
    ).exec()
    return result.upsertedCount > 0
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
