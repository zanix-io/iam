import { seedManyByIdIfMissing } from '@zanix/datamaster'
import { DEV_USER_ID } from '../../users/seeders/seeders.dev.ts'
import { SUPERADMIN_ROLE_ID } from '../../roles/seeders/seeders.prod.ts'
import { computeEmailKeyId } from '../email-key.ts'
import { SERVICE_ID } from 'utils/constants.ts'

/**
 * Local-dev-only account id, referenced by other domains' own dev seeders. Must be a real
 * 24-character hex ObjectId — like every other model in this project, `auth`'s own `_id` is the
 * Mongoose-default `Schema.Types.ObjectId`-typed field (no override in `model.defs.ts`), so it
 * fails to cast anything else, exactly like `userId` (see `model.defs.ts`'s own doc on that field).
 * Distinct from `DEV_USER_ID` and every other seeded dev id in this project.
 */
export const DEV_AUTH_ID = '693000000000000000000002'

/** Local-dev-only password for `DEV_AUTH_ID` — hashed automatically on insert. No 2FA configured. */
export const DEV_AUTH_PASSWORD = 'DevPass123!'

/** This project's dev-only bootstrap account's email — derived from {@linkcode SERVICE_ID} so a
 * self-hosted instance's dev environment doesn't seed a `zanix-iam`-branded address either. */
export const DEV_AUTH_EMAIL = `dev@${SERVICE_ID}.local`

const data = [{
  id: DEV_AUTH_ID,
  email: DEV_AUTH_EMAIL,
  // `seedManyByIdIfMissing`'s own bulk upsert path never runs a `pre('save')` hook, and
  // `emailKeyId` is a plain, unprotected field `useDataPolicies` has no policy to auto-populate
  // for (see `entity.provider.ts`'s own doc) — so it's computed here, via a top-level `await` of
  // `computeEmailKeyId(DEV_AUTH_EMAIL)`, rather than a stale hardcoded literal that would silently
  // stop matching `DEV_AUTH_EMAIL` the moment `SERVICE_ID` is overridden.
  emailKeyId: await computeEmailKeyId(DEV_AUTH_EMAIL),
  // Hashed automatically on insert (useDataPolicies: true) — verified at login via
  // `auth.password.verify(password)` (see `AuthService.loginWithPassword`).
  password: DEV_AUTH_PASSWORD,
  // Links to the `users` domain's own dev profile — see that seeder's own doc for why this MUST be
  // a real hex ObjectId, exactly like this record's own `id` above.
  userId: DEV_USER_ID,
  // The `superadmin` role (wildcard permission), so a fresh environment's first login has full
  // administrative access. `seedManyByIdIfMissing` only inserts (`$setOnInsert`), so a record
  // already seeded without roles keeps lacking them; assign it with `RolesService.addRoles`.
  roleIds: [SUPERADMIN_ROLE_ID],
}]

/** This project's dev-only bootstrap `auth` account (`DEV_AUTH_ID`), upserted on boot via
 * `seedManyByIdIfMissing` when `ENV` isn't `'production'` (see `utils/seeders.ts`). */
export default [
  {
    handler: seedManyByIdIfMissing(data, { useDataPolicies: true }),
    options: { version: '1.0.0' },
  } as const,
] as never[]
