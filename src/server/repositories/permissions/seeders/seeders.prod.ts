import { seedManyByIdIfMissing } from '@zanix/datamaster'
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
]

/** This project's production-always permission catalog: the wildcard permission plus every
 * `RBAC_PERMISSIONS` entry, upserted on boot via `seedManyByIdIfMissing`. */
export default [
  {
    handler: seedManyByIdIfMissing(SEEDED_PERMISSIONS),
    options: { version: '1.1.0' },
  } as const,
] as never[]
