import { registerModel, Schema } from '@zanix/datamaster'
import seeders from './seeders/main.ts'

/**
 * The `grant_accesses` collection — fine-grained, resource-level access grants, independent from
 * the `roles`/`permissions` RBAC catalog (a role's permissions gate WHICH admin endpoints a
 * caller may hit at all; a grant answers a narrower, per-resource question: does THIS user have
 * at-least-level-Y access to THIS specific resource). See `grant-access.app.ts`'s own
 * `evaluateGrantAccess` behavior for how a grant is actually evaluated against a required level.
 *
 * **Deliberate deviations from this domain slice's own grounding reference**
 * (`ms-iam`'s `GrantAccessAttrs`):
 * - No `type` field. The reference's only real value (`'subsidiary'`) is domain-specific to that
 *   product, not generic — `resourceId` alone is enough to disambiguate what's being granted
 *   access to; a consumer wanting a "kind" distinction can already encode it into `resourceId`
 *   itself (see that field's own doc below).
 * - `organizationId` (required, `ObjectId`, this project's own tenant/org service) is renamed and
 *   generalized to `tenantId` (optional, plain `string`) — see `roles.tenantId`'s own doc
 *   (`../roles/model.defs.ts`) for the identical reasoning, applied here to grants instead of
 *   roles.
 * - `resourceId`/`userId`/`grantedBy` are NOT `Schema.Types.ObjectId` the way the reference typed
 *   `resourceId` — see `resourceId`'s own doc for why it's a plain, unvalidated `string` here.
 *   `userId`/`grantedBy` DO stay `ObjectId`-refs to `users`, matching this project's own real
 *   collection (the reference's `users` ref is the same idea, just now backed by a real sibling
 *   slice instead of an assumption).
 */
export type GrantAccessAttrs = {
  id: string
  /** Ref to `users` — the account this grant applies to. */
  userId: string
  /**
   * Fully generic, unvalidated string — `zanix-iam` never interprets or validates what it names.
   * DEFAULT convention for a resource that is an operation on another `@zanix/app`-composed
   * service: `"${appName}:${operationName}"` — the exact same qualified-key shape
   * `@zanix/app`'s own Control Plane/operation registry already uses internally (see
   * `app-hot-install-and-multitenancy`/`app-remote-calls-and-control-plane`), so a grant checked
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
    // Renaming `createdAt` to `grantedAt` (matching the grounding reference), but — unlike that
    // reference, whose own `GrantAccessAttrs` type never declares an `updatedAt` field at all even
    // though Mongoose still tracks one under its default name when only `createdAt` is
    // renamed — this model's own type above DOES declare `updatedAt`, so an `updateAccess` call
    // always has a real, typed field to report a fresh value from.
    timestamps: { createdAt: 'grantedAt' },
  },
  callback: (schema) => {
    // A document with no `tenantId` is indexed as `tenantId: null` — one active/inactive grant
    // record per `{userId, resourceId, tenantId}` tuple, tenant-scoped or global.
    schema.index({ userId: 1, resourceId: 1, tenantId: 1 }, { unique: true })
    return schema
  },
})
