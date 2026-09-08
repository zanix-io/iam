import type { PermissionsAttrs } from '../permissions/model.defs.ts'

import { registerModel, Schema } from '@zanix/datamaster'
import seeders from './seeders/main.ts'

/**
 * The `roles` collection — a named, reusable bundle of `permissions` (see that model's own doc)
 * assignable to an `auth` account via its single `roleId` ref (`AuthenticationAttrs.roleId` —
 * already fixed by the `auth` domain slice, not something this one changes).
 *
 * **What "multi-tenancy" means here — SaaS-shaped, not multi-product**: `zanix-iam` serves ONE
 * product per deployment, the same product `ms-iam` (this domain slice's own grounding reference)
 * serves. `tenantId` below is that ONE product's own multi-customer/multi-organization
 * partitioning — the same shape `ms-iam`'s own `organizationId` gives it — never a mechanism for
 * isolating several UNRELATED products sharing one deployment (an Auth0/Okta-shaped
 * identity-provider-as-a-service, which would additionally need per-product OAuth2 redirect URIs,
 * per-product JWT `aud`/`iss` claims, a tenant-scoped `RBAC_PERMISSIONS` catalog, and more — a
 * separate, much bigger design this project doesn't take on).
 *
 * `tenantId` (a plain, opaque, unowned foreign id — no `ref:`; this project has no tenants
 * collection of its own and never will, exactly like the real reference architecture where
 * `ms-iam` never owns `organizations` either — a separate microservice does) gives real, optional,
 * per-customer/organization scoping for this one product, without reusing `ms-iam`'s own
 * `organizationId`/`{code, organizationId}` shape: this project owns no `organizations` collection,
 * and `auth.roleId` (a SINGLE ref) still only ever points at ONE role at a time — a `tenantId`
 * absent means a global/system role (assignable regardless of tenant), present means a
 * tenant-scoped one, so `auth.roleId`'s single-ref shape simply widens what "one role" can mean
 * per code, without needing a tenant-scoped catalog structure of its own. `permissions` stays
 * completely untouched by this — see that model's own doc for why its catalog stays
 * global/tenant-agnostic. See `AuthenticationAttrs`'s own doc (`../auth/model.defs.ts`) for why
 * `auth`/`users` deliberately carry no equivalent field.
 */
export type RolesAttrs = {
  id: string
  name: string
  code: string
  description: string
  /**
   * Plain, opaque, unowned foreign id — `zanix-iam` never validates or interprets its shape,
   * beyond using it for equality-scoped filtering (`RolesRepository.findByCode`/`searchRoles`).
   * Absent = a global/system role, usable by any tenant; present = scoped to that one tenant only
   * (see the unique index below). Owned and managed entirely by whatever the consuming system uses
   * for tenancy — this project stores it, never resolves/populates it.
   */
  tenantId?: string
  /** Ref array to `permissions` — `PermissionsAttrs[]` once populated (see
   * `RolesRepository.findById`'s own `populate` option), plain id strings otherwise. */
  permissions: string[] | PermissionsAttrs[]
  /** The `users.id` of the admin who created this role — unset for a seeded/system entry. */
  createdBy?: string
  createdAt: Date
  updatedAt: Date
}

registerModel<RolesAttrs>({
  name: 'roles',
  definition: {
    name: {
      type: String,
      required: true,
    },
    // No field-level `unique: true` here anymore — uniqueness is now the compound
    // `{code, tenantId}` index below, so the same `code` may exist once per tenant plus once
    // globally (`tenantId` absent).
    code: {
      type: String,
      required: true,
    },
    // Plain `String`, deliberately not `Schema.Types.ObjectId` — this project makes no assumption
    // about the consuming system's own tenant-id format (a UUID, a slug, a Mongo ObjectId, ...);
    // see the type's own doc above.
    tenantId: String,
    description: {
      type: String,
      required: true,
    },
    permissions: {
      type: [Schema.Types.ObjectId],
      ref: 'permissions',
      required: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'users',
    },
  },
  extensions: {
    seeders,
  },
  options: {
    timestamps: true,
  },
  callback: (schema) => {
    // A document with no `tenantId` is indexed as `tenantId: null` by MongoDB, so this also
    // enforces at most one GLOBAL role per `code` — mirrors the grounding reference's own
    // `{code, organizationId}` unique-index shape, generalized and renamed.
    schema.index({ code: 1, tenantId: 1 }, { unique: true })
    return schema
  },
})
