import { assertEquals } from 'jsr:@std/assert@0.224'
import { FIRST_ADMIN_EMAIL_ENV, FIRST_ADMIN_PASSWORD_ENV } from 'utils/constants.ts'

/**
 * The `users`/`auth` `seeders.prod.ts` default exports are computed once, at module load, from
 * `FIRST_ADMIN_EMAIL`/`FIRST_ADMIN_PASSWORD`. Their per-file tests only ever load them with both
 * unset (an empty seeder list); this file sets both BEFORE the modules' first evaluation in this
 * isolate, then restores the process-wide environment immediately, so the configured branch runs
 * against the real module URLs.
 */
const original = {
  email: Deno.env.get(FIRST_ADMIN_EMAIL_ENV),
  password: Deno.env.get(FIRST_ADMIN_PASSWORD_ENV),
}
Deno.env.set(FIRST_ADMIN_EMAIL_ENV, 'admin@example.com')
Deno.env.set(FIRST_ADMIN_PASSWORD_ENV, 'Sup3rSecret!')
const [{ default: usersSeeders }, { default: authSeeders }] = await Promise.all([
  import('server/repositories/users/seeders/seeders.prod.ts'),
  import('server/repositories/auth/seeders/seeders.prod.ts'),
])
for (
  const [key, value] of [
    [FIRST_ADMIN_EMAIL_ENV, original.email],
    [FIRST_ADMIN_PASSWORD_ENV, original.password],
  ] as const
) {
  if (value === undefined) Deno.env.delete(key)
  else Deno.env.set(key, value)
}

type Seeder = { handler: unknown; options: { version: string } }

Deno.test('seeders.prod (users/auth): with both first-admin env vars set, each exports one versioned seeder', () => {
  for (const seeders of [usersSeeders as Seeder[], authSeeders as Seeder[]]) {
    assertEquals(seeders.length, 1)
    assertEquals(seeders[0].options, { version: '1.0.0' })
    assertEquals(typeof seeders[0].handler, 'function')
  }
})
