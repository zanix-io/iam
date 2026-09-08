import { seedManyByIdIfMissing } from '@zanix/datamaster'
import { WILDCARD_PERMISSION_ID } from '../../permissions/seeders/seeders.prod.ts'

/**
 * The one role holding the wildcard permission (see `WILDCARD_PERMISSION_ID`'s own doc) — this
 * project's only real bootstrap path for a first administrative account. Assign it via
 * `RolesService.assignRole`, then immediately create narrower roles for everyone else.
 */
export const SUPERADMIN_ROLE_ID = '693000000000000000000201'

const data = [
  {
    id: SUPERADMIN_ROLE_ID,
    code: 'superadmin',
    name: 'Super Administrator',
    description:
      'Unrestricted administrative access to every module in this project, including managing ' +
      'roles and the permission catalog itself. Assign sparingly.',
    permissions: [WILDCARD_PERMISSION_ID],
  },
]

/** This project's production-always role catalog: just the seeded `superadmin` role, upserted on
 * boot via `seedManyByIdIfMissing`. */
export default [
  {
    handler: seedManyByIdIfMissing(data),
    options: { version: '1.0.0' },
  } as const,
] as never[]
