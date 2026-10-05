import logger from '@zanix/logger'
import { RBAC_PERMISSIONS } from 'utils/constants.ts'

/**
 * Wildcard permission — `@zanix/auth`'s own `scopeValidation` special-cases a session scope
 * containing `'*'` to grant access to every permission-gated route unconditionally. Seeded in PRODUCTION (not dev-only): with no seeded role
 * holding it, nothing could ever grant itself `role-write`/`permission-write` to build any other
 * role by hand — this is this project's only real bootstrap path for a first administrative
 * account. See the `superadmin` role in `roles/seeders/seeders.prod.ts`, the sole role assigned it.
 */
export const WILDCARD_PERMISSION_ID = '693000000000000000000100'

/** This project's OWN admin-endpoint permissions — real, always-needed system data (not
 * dev/test fixtures), so these live here rather than in `seeders.dev.ts`. */
export const RBAC_PERMISSION_ROLE_READ_ID = '693000000000000000000101'
/** See {@linkcode RBAC_PERMISSION_ROLE_READ_ID}'s own doc. */
export const RBAC_PERMISSION_ROLE_WRITE_ID = '693000000000000000000102'
/** See {@linkcode RBAC_PERMISSION_ROLE_READ_ID}'s own doc. */
export const RBAC_PERMISSION_PERMISSION_READ_ID = '693000000000000000000103'
/** See {@linkcode RBAC_PERMISSION_ROLE_READ_ID}'s own doc. */
export const RBAC_PERMISSION_PERMISSION_WRITE_ID = '693000000000000000000104'
/** See {@linkcode RBAC_PERMISSION_ROLE_READ_ID}'s own doc. */
export const RBAC_PERMISSION_USER_READ_ID = '693000000000000000000105'
/** See {@linkcode RBAC_PERMISSION_ROLE_READ_ID}'s own doc. */
export const RBAC_PERMISSION_USER_WRITE_ID = '693000000000000000000106'
/** See {@linkcode RBAC_PERMISSION_ROLE_READ_ID}'s own doc. */
export const RBAC_PERMISSION_GRANT_ACCESS_READ_ID = '693000000000000000000107'
/** See {@linkcode RBAC_PERMISSION_ROLE_READ_ID}'s own doc. */
export const RBAC_PERMISSION_GRANT_ACCESS_WRITE_ID = '693000000000000000000108'
/** See {@linkcode RBAC_PERMISSION_ROLE_READ_ID}'s own doc. */
export const RBAC_PERMISSION_TEMPLATES_ACCESS_ID = '693000000000000000000109'

/** See {@linkcode RBAC_PERMISSION_ROLE_READ_ID}'s own doc. */
export const RBAC_PERMISSION_AUDIT_READ_ID = '693000000000000000000110'

/** Every seeded permission: the wildcard plus one entry per `RBAC_PERMISSIONS` code. */
export const SEEDED_PERMISSIONS = [
  {
    id: WILDCARD_PERMISSION_ID,
    code: '*',
    name: 'All grants',
    description:
      'Grants unrestricted access to every permission-gated route, bypassing every individual ' +
      'permission check. Assign only via the seeded `superadmin` role.',
    isActive: true,
  },
  {
    id: RBAC_PERMISSION_ROLE_READ_ID,
    code: RBAC_PERMISSIONS.roleRead,
    name: 'Read roles',
    description: 'List/view roles.',
    isActive: true,
  },
  {
    id: RBAC_PERMISSION_ROLE_WRITE_ID,
    code: RBAC_PERMISSIONS.roleWrite,
    name: 'Manage roles',
    description: 'Create/edit/delete roles, and assign a role to an account.',
    isActive: true,
  },
  {
    id: RBAC_PERMISSION_PERMISSION_READ_ID,
    code: RBAC_PERMISSIONS.permissionRead,
    name: 'Read permissions',
    description: 'List/view the permission catalog.',
    isActive: true,
  },
  {
    id: RBAC_PERMISSION_PERMISSION_WRITE_ID,
    code: RBAC_PERMISSIONS.permissionWrite,
    name: 'Manage permissions',
    description: 'Create/edit entries in the permission catalog.',
    isActive: true,
  },
  {
    id: RBAC_PERMISSION_USER_READ_ID,
    code: RBAC_PERMISSIONS.userRead,
    name: 'Read users',
    description: 'List/view any user profile by id.',
    isActive: true,
  },
  {
    id: RBAC_PERMISSION_USER_WRITE_ID,
    code: RBAC_PERMISSIONS.userWrite,
    name: 'Manage users',
    description: 'Register a new user profile, and edit/deactivate an existing one by id.',
    isActive: true,
  },
  {
    id: RBAC_PERMISSION_GRANT_ACCESS_READ_ID,
    code: RBAC_PERMISSIONS.grantAccessRead,
    name: 'Read access grants',
    description: 'List/view per-resource access grants and check a grant.',
    isActive: true,
  },
  {
    id: RBAC_PERMISSION_GRANT_ACCESS_WRITE_ID,
    code: RBAC_PERMISSIONS.grantAccessWrite,
    name: 'Manage access grants',
    description: 'Create/edit/revoke per-resource access grants.',
    isActive: true,
  },
  {
    id: RBAC_PERMISSION_TEMPLATES_ACCESS_ID,
    code: RBAC_PERMISSIONS.templatesAccess,
    name: 'Manage notification templates',
    description: 'Use the `/templates` CRUD API over database-backed template overrides.',
    isActive: true,
  },
  {
    id: RBAC_PERMISSION_AUDIT_READ_ID,
    code: RBAC_PERMISSIONS.auditRead,
    name: 'Read the audit trail',
    description: 'List the recorded changes to roles, permissions and account status.',
    isActive: true,
  },
]

/** The part of the `permissions` model the seeder uses. */
type PermissionsSeedModel = {
  find: (filter: Record<string, unknown>) => { lean: () => PromiseLike<{ code: string }[]> }
  upsertManyById: (
    data: typeof SEEDED_PERMISSIONS,
    options: { useDataPolicies: boolean },
  ) => PromiseLike<unknown>
}

/**
 * Inserts every seeded permission that is missing, by id, and leaves the ones present untouched.
 * A seeded code that already exists under ANOTHER id (an administrator created `audit-read` by
 * hand, say) is skipped with a warning instead of failing on the unique index of `code`: routes
 * check permissions by code, so the existing permission serves, and nothing is overwritten.
 *
 * Seeders run once per name and version (`zanix-seeders`), so a permission added to the catalog
 * needs a new `version` below to reach a database that already ran an earlier one.
 */
export async function seedMissingPermissions(Model: PermissionsSeedModel): Promise<void> {
  const taken = await Model.find({ code: { $in: SEEDED_PERMISSIONS.map(({ code }) => code) } })
    .lean() as unknown as { _id: { toString(): string }; code: string }[]
  const byId = new Map(taken.map((permission) => [String(permission._id), permission.code]))
  const takenCodes = new Set(taken.map((permission) => permission.code))
  const toInsert = SEEDED_PERMISSIONS.filter((permission) => {
    if (!takenCodes.has(permission.code)) return true
    if (byId.has(permission.id)) return false
    logger.warn(
      `Permission "${permission.code}" already exists under another id; the seeded one ` +
        `(${permission.id}) is skipped and the existing one is used.`,
    )
    return false
  })
  if (toInsert.length) await Model.upsertManyById(toInsert, { useDataPolicies: true })
}

/** This project's production-always permission catalog: the wildcard permission plus every
 * `RBAC_PERMISSIONS` entry, inserted on boot when missing (see {@linkcode seedMissingPermissions}).
 * Version `1.2.0` is the one that adds `audit-read` to databases created by 1.x. */
export default [
  {
    handler: seedMissingPermissions as never,
    options: { name: 'seedMissingPermissions', version: '1.2.0' },
  } as const,
] as never[]
