import { seedManyByIdIfMissing } from '@zanix/datamaster'
import { WILDCARD_PERMISSION_ID } from '../../permissions/seeders/seeders.prod.ts'

/**
 * The one role holding the wildcard permission (see `WILDCARD_PERMISSION_ID`'s own doc) — this
 * project's only real bootstrap path for a first administrative account. Assign it via
 * `RolesService.addRoles`, then immediately create narrower roles for everyone else.
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
    isSystem: true,
  },
]

/** The part of the `roles` model the seeder uses. */
type RolesSeedModel = {
  updateOne: (
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: Record<string, unknown>,
  ) => PromiseLike<unknown>
}

/**
 * Marks the seeded `superadmin` as a system role in a database that already had it. Role seeding
 * only inserts, so a `superadmin` written by 1.x never got `isSystem`. Writes only when the field
 * is missing and touches nothing else (not even `updatedAt`). `isSystem` is immutable in the
 * schema, which makes Mongoose drop updates to it unless `overwriteImmutable` says otherwise: this
 * is the one place that is intended.
 */
export async function markSuperadminAsSystem(Model: RolesSeedModel): Promise<void> {
  await Model.updateOne(
    { _id: SUPERADMIN_ROLE_ID, isSystem: { $exists: false } },
    { $set: { isSystem: true } },
    { overwriteImmutable: true, timestamps: false },
  )
}

/** This project's production-always role catalog: the seeded `superadmin` role, inserted on boot
 * when missing, then marked as a system role when it predates that field (version `1.1.0`). */
export default [
  {
    handler: seedManyByIdIfMissing(data),
    options: { version: '1.0.0' },
  } as const,
  {
    handler: markSuperadminAsSystem as never,
    options: { name: 'markSuperadminAsSystem', version: '1.1.0' },
  } as const,
] as never[]
