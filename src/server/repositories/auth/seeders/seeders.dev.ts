import { seedManyByIdIfMissing } from '@zanix/datamaster'
import { DEV_USER_ID } from '../../users/seeders/seeders.dev.ts'
import { SUPERADMIN_ROLE_ID } from '../../roles/seeders/seeders.prod.ts'

/**
 * Local-dev-only account id, referenced by any future slice's own dev seeders. Must be a real
 * 24-character hex ObjectId — like every other model in this project, `auth`'s own `_id` is the
 * Mongoose-default `Schema.Types.ObjectId`-typed field (no override in `model.defs.ts`), so it
 * fails to cast anything else, exactly like `userId` (see `model.defs.ts`'s own doc on that field).
 * Distinct from `DEV_USER_ID` and every other seeded dev id in this project.
 */
export const DEV_AUTH_ID = '693000000000000000000002'

/** Local-dev-only password for `DEV_AUTH_ID` — hashed automatically on insert. No 2FA configured. */
export const DEV_AUTH_PASSWORD = 'DevPass123!'

const data = [{
  id: DEV_AUTH_ID,
  email: 'dev@zanix-iam.local',
  // Precomputed via `computeEmailKeyId('dev@zanix-iam.local')` — `seedManyByIdIfMissing`'s own
  // bulk upsert path never runs a `pre('save')` hook, and `emailKeyId` is a plain, unprotected
  // field `useDataPolicies` has no policy to auto-populate for (see `entity.provider.ts`'s own
  // doc), so it has to be a real, precomputed literal here rather than derived at seed time.
  emailKeyId: 'z/g1KkUpQzbJvd7ZgJDBmzUAnIQ=',
  // Hashed automatically on insert (useDataPolicies: true) — verified at login via
  // `auth.password.verify(password)` (see `AuthService.loginWithPassword`).
  password: DEV_AUTH_PASSWORD,
  // Links to the `users` slice's own dev profile — see that seeder's own doc for why this MUST be
  // a real hex ObjectId, exactly like this record's own `id` above.
  userId: DEV_USER_ID,
  // Grants this bootstrap account the wildcard permission so a fresh environment's first login
  // already has full administrative access, matching every other Zanix project's own dev-seed
  // convention. `seedManyByIdIfMissing` only ever inserts (`$setOnInsert`) — it never updates an
  // already-existing document — so this has no effect on an environment whose `auths` collection
  // already seeded this record before this field existed; that environment needs a one-time manual
  // backfill (e.g. via `RolesService.assignRole`, or a direct update of this record's `roleId` to
  // `SUPERADMIN_ROLE_ID`) instead.
  roleId: SUPERADMIN_ROLE_ID,
}]

/** This project's dev-only bootstrap `auth` account (`DEV_AUTH_ID`), upserted on boot via
 * `seedManyByIdIfMissing` when `ENV` isn't `'production'` (see `utils/seeders.ts`). */
export default [
  {
    handler: seedManyByIdIfMissing(data, { useDataPolicies: true }),
    options: { version: '1.0.0' },
  } as const,
] as never[]
