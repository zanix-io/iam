import { seedManyByIdIfMissing } from '@zanix/datamaster'
import { FIRST_ADMIN_EMAIL_ENV, FIRST_ADMIN_PASSWORD_ENV } from 'utils/constants.ts'

/**
 * The first-admin bootstrap profile's own id, linked from `auth/seeders/seeders.prod.ts`'s own
 * `FIRST_ADMIN_AUTH_ID` via `AuthenticationAttrs.userId` — same fixed-id cross-reference pattern
 * `seeders.dev.ts`'s own `DEV_USER_ID`/`DEV_AUTH_ID` already establish, so no dynamically-created
 * id has to be passed between the `users` and `auth` collections' own, separately-registered
 * seeders (see `auth/seeders/seeders.prod.ts`'s own doc for why that dynamic-id coordination is
 * the real reason this isn't built as a single `setup()` hook instead).
 */
export const FIRST_ADMIN_USER_ID = '693000000000000000000301'

/**
 * Opt-in only: resolves to the bootstrap profile exclusively when BOTH
 * {@linkcode FIRST_ADMIN_EMAIL_ENV} and `FIRST_ADMIN_PASSWORD_ENV` are set (checked here
 * identically to `auth/seeders/seeders.prod.ts`, which owns the actual credential) — a fresh,
 * genuinely empty deployment otherwise has no production-safe path to its first administrative
 * account (`POST /users/register` itself is gated behind `RBAC_PERMISSIONS.userWrite`, which
 * nobody holds yet). Never seeded from a default — there is no default; unset env vars mean no
 * admin is seeded at all, matching this project's own "no guessable credential, ever" posture.
 * Extracted as a pure function of the current environment, separate from `data`'s own
 * module-load-time call, purely so it can be exercised directly against both env-var states.
 */
export function resolveFirstAdminUserData(): { id: string }[] {
  return Deno.env.has(FIRST_ADMIN_EMAIL_ENV) && Deno.env.has(FIRST_ADMIN_PASSWORD_ENV)
    ? [{ id: FIRST_ADMIN_USER_ID }]
    : []
}

const data = resolveFirstAdminUserData()

/** This project's production-always `users` fixtures: the opt-in first-admin bootstrap profile
 * (see {@linkcode FIRST_ADMIN_USER_ID}'s own doc), upserted on boot via `seedManyByIdIfMissing`
 * when configured — otherwise empty, exactly like this file's own prior state. Every other real
 * `users` profile is either registered through `UsersService.registerUser`, or (dev-only)
 * `seeders.dev.ts`'s own bootstrap profile. */
export default (data.length
  ? [
    {
      handler: seedManyByIdIfMissing(data, { useDataPolicies: true }),
      options: { version: '1.0.0' },
    } as const,
  ]
  : []) as never[]
