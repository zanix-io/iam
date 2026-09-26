import { registerModel, Schema } from '@zanix/datamaster'
import seeders from './seeders/main.ts'

/**
 * The `permissions` collection — the flat catalog of permission codes (`module:action`, see
 * `IsPermission`) a `roles` document references by id. Deactivating one (`isActive: false`)
 * removes it from every role's effective permission set on next login (see
 * `resolveEffectivePermissions`) without editing each role individually.
 *
 * `code: '*'` is a real, reserved wildcard value — `@zanix/auth`'s own `scopeValidation` grants
 * access to every permission-gated route to a session whose scope includes it. Seeded once, in production, as the sole permission the
 * `superadmin` role holds (`roles/seeders/seeders.prod.ts`) — this project's only real bootstrap
 * path for a first administrative account.
 */
export type PermissionsAttrs = {
  id: string
  code: string
  name: string
  description: string
  categories?: string[]
  isActive: boolean
  /** The `users.id` of the admin who created this permission — unset for a seeded/system entry. */
  createdBy?: string
  createdAt: Date
  updatedAt: Date
}

registerModel<PermissionsAttrs>({
  name: 'permissions',
  definition: {
    code: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    categories: [String],
    isActive: {
      type: Boolean,
      required: true,
      default: true,
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
})
