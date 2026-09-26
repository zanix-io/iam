import { seedManyByIdIfMissing } from '@zanix/datamaster'
import { computeEmailKeyId } from '../email-key.ts'
import { FIRST_ADMIN_USER_ID } from '../../users/seeders/seeders.prod.ts'
import { SUPERADMIN_ROLE_ID } from '../../roles/seeders/seeders.prod.ts'
import { FIRST_ADMIN_EMAIL_ENV, FIRST_ADMIN_PASSWORD_ENV } from 'utils/constants.ts'

/**
 * The first-admin bootstrap account's own id — see `users/seeders/seeders.prod.ts`'s own doc for
 * why this uses the same fixed-id cross-reference pattern as `seeders.dev.ts`'s `DEV_AUTH_ID`,
 * rather than a dynamically-created id passed between collections. That dynamic-id coordination is
 * exactly why this bootstrap ISN'T built as a single `setup()` hook instead: the connector-level
 * seeder system (`seedManyByIdIfMissing`, this file, `users/seeders/seeders.prod.ts`) runs per
 * collection at that collection's own model-registration time — a `setup()` hook would have to
 * create `users` first, read back its generated id, THEN create `auth` with it, all inside one
 * ordered block; fixed ids sidestep that ordering entirely, the same way this project's own dev
 * seeders already do.
 */
export const FIRST_ADMIN_AUTH_ID = '693000000000000000000302'

export type FirstAdminAuthData = {
  id: string
  email: string
  emailKeyId: string
  password: string
  userId: string
  roleId: string
}

/**
 * Opt-in only — see {@linkcode FIRST_ADMIN_EMAIL_ENV}'s own doc. `roleId: SUPERADMIN_ROLE_ID` is
 * set directly here, at creation, rather than via a separate `RolesService.assignRole` call
 * afterward (the manual step `roles/seeders/seeders.prod.ts`'s own doc describes) — assigning a
 * role to an ALREADY-existing account is what that service method is for; this account doesn't
 * exist yet, so there's nothing to assign a role to after the fact. `password` is hashed
 * automatically on insert (`useDataPolicies: true`, `protection: 'hash'`) — never handled in plain
 * text beyond this function's own `Deno.env.get`. Extracted as a pure(-ish; `computeEmailKeyId` is
 * a deterministic digest, not an IO call) async function of the current environment, separate from
 * `data`'s own module-load-time call, purely so it can be exercised directly against both env-var
 * states.
 */
export async function resolveFirstAdminAuthData(): Promise<FirstAdminAuthData[]> {
  const firstAdminEmail = Deno.env.get(FIRST_ADMIN_EMAIL_ENV)
  const firstAdminPassword = Deno.env.get(FIRST_ADMIN_PASSWORD_ENV)
  if (!firstAdminEmail || !firstAdminPassword) return []

  return [{
    id: FIRST_ADMIN_AUTH_ID,
    email: firstAdminEmail,
    // Precomputed here for the same reason `seeders.dev.ts`'s own `DEV_AUTH_EMAIL` entry is:
    // `seedManyByIdIfMissing`'s bulk upsert path never runs a `pre('save')` hook, so `emailKeyId`
    // — a plain, unprotected field — has no other path to get populated at insert time.
    emailKeyId: await computeEmailKeyId(firstAdminEmail),
    password: firstAdminPassword,
    userId: FIRST_ADMIN_USER_ID,
    roleId: SUPERADMIN_ROLE_ID,
  }]
}

const data = await resolveFirstAdminAuthData()

/** This project's production-always `auth` fixtures: the opt-in first-admin bootstrap account (see
 * {@linkcode FIRST_ADMIN_AUTH_ID}'s own doc), upserted on boot via `seedManyByIdIfMissing` when
 * configured — otherwise empty. Every other `auth` account is registered through
 * `UsersService.registerUser`, OTP/OAuth2 self-registration (`AuthService.loginWithOTPCallback`/
 * `loginWithOauthCallback`), or (dev-only) `seeders.dev.ts`'s own bootstrap account. */
export default (data.length
  ? [
    {
      handler: seedManyByIdIfMissing(data, { useDataPolicies: true }),
      options: { version: '1.0.0' },
    } as const,
  ]
  : []) as never[]
