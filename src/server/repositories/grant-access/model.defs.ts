import { registerModel, Schema } from '@zanix/datamaster'
import seeders from './seeders/main.ts'

/**
 * The `grant_accesses` collection — fine-grained, resource-level access grants, independent from
 * the `roles`/`permissions` RBAC catalog (a role's permissions gate WHICH admin endpoints a
 * caller may hit at all; a grant answers a narrower, per-resource question: does THIS user have
 * at-least-level-Y access to THIS specific resource). See `grant-access.app.ts`'s own
 * `evaluateGrantAccess` behavior for how a grant is actually evaluated against a required level.
 *
 * Shape notes:
 * - No `type` field — `resourceId` alone disambiguates what's being granted access to; a consumer
 *   wanting a "kind" distinction encodes it into `resourceId` itself (see that field's own doc).
 * - `tenantId` is optional and a plain `string` — see `roles.tenantId`'s own doc
 *   (`../roles/model.defs.ts`) for the identical reasoning.
 * - `resourceId` is a plain, unvalidated `string` (see its own doc); `userId`/`grantedBy` are
 *   `ObjectId` refs to `users`.
 */
export type GrantAccessAttrs = {
  id: string
  /** Ref to `users` — the account this grant applies to. */
  userId: string
  /**
   * Fully generic, unvalidated string — this project never interprets or validates what it names.
   * DEFAULT convention for a resource that is an operation on another `@zanix/app`-composed
   * service: `"${appName}:${operationName}"` — the exact same qualified-key shape
   * `@zanix/app`'s own Control Plane/operation registry uses internally, so a grant checked
   * from inside that operation's own handler can reuse `ctx`'s own app/operation names verbatim
   * to build this value, with no separate naming scheme to invent. This is a DOCUMENTED
   * convention only, never enforced by a schema constraint — a consumer not modeling resources as
   * `@zanix/app` operations may put anything else here (a URL, a database record id, ...).
   */
  resourceId: string
  /** Plain, opaque, unowned tenant id — see `RolesAttrs.tenantId`'s own doc
   * (`../roles/model.defs.ts`) for the identical shape/reasoning. Absent = a grant scoped
   * globally (not tied to any one tenant). */
  tenantId?: string
  /** Free-form string, not constrained to `DEFAULT_ACCESS_LEVELS` (`utils/constants.ts`) at the
   * schema level — see that constant's own doc, and `evaluateGrantAccess`'s default
   * implementation, for how an arbitrary value is still evaluated safely (exact-match fallback). */
  accessLevel: string
  /** Absent = never expires. */
  expiresAt?: Date
  isActive: boolean
  /** Ref to `users` — the admin who created this grant. */
  grantedBy: string
  grantedAt: Date
  updatedAt: Date
}

registerModel<GrantAccessAttrs>({
  name: 'grant_accesses',
  definition: {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'users',
      required: true,
    },
    resourceId: {
      type: String,
      required: true,
    },
    tenantId: String,
    accessLevel: {
      type: String,
      required: true,
    },
    expiresAt: Date,
    isActive: {
      type: Boolean,
      required: true,
      default: true,
    },
    grantedBy: {
      type: Schema.Types.ObjectId,
      ref: 'users',
      required: true,
    },
  },
  extensions: {
    seeders,
  },
  options: {
    // `createdAt` is renamed to `grantedAt`; Mongoose still tracks `updatedAt` under its default
    // name, which the type above declares too.
    timestamps: { createdAt: 'grantedAt' },
  },
  callback: (schema) => {
    // A document with no `tenantId` is indexed as `tenantId: null` — one active/inactive grant
    // record per `{userId, resourceId, tenantId}` tuple, tenant-scoped or global.
    schema.index({ userId: 1, resourceId: 1, tenantId: 1 }, { unique: true })
    return schema
  },
})
