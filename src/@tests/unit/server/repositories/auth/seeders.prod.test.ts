import { assertEquals } from 'jsr:@std/assert@0.224'

import seedersProd, {
  FIRST_ADMIN_AUTH_ID,
  resolveFirstAdminAuthData,
} from 'server/repositories/auth/seeders/seeders.prod.ts'
import { FIRST_ADMIN_USER_ID } from 'server/repositories/users/seeders/seeders.prod.ts'
import { SUPERADMIN_ROLE_ID } from 'server/repositories/roles/seeders/seeders.prod.ts'
import { computeEmailKeyId } from 'server/repositories/auth/email-key.ts'
import { FIRST_ADMIN_EMAIL_ENV, FIRST_ADMIN_PASSWORD_ENV } from 'utils/constants.ts'

function withEnv(name: string, value: string | undefined, run: () => void | Promise<void>) {
  const original = Deno.env.get(name)
  if (value === undefined) Deno.env.delete(name)
  else Deno.env.set(name, value)
  return (async () => {
    try {
      await run()
    } finally {
      if (original === undefined) Deno.env.delete(name)
      else Deno.env.set(name, original)
    }
  })()
}

/** Same module-load-time limitation `users/seeders.prod.test.ts` documents — see that file. */
Deno.test('seeders.prod (auth): empty when FIRST_ADMIN_EMAIL/FIRST_ADMIN_PASSWORD are unset', () => {
  assertEquals(Deno.env.get(FIRST_ADMIN_EMAIL_ENV), undefined)
  assertEquals(Deno.env.get(FIRST_ADMIN_PASSWORD_ENV), undefined)
  assertEquals(seedersProd, [])
})

Deno.test('resolveFirstAdminAuthData: empty with neither env var set', async () => {
  await withEnv(
    FIRST_ADMIN_EMAIL_ENV,
    undefined,
    () =>
      withEnv(FIRST_ADMIN_PASSWORD_ENV, undefined, async () => {
        assertEquals(await resolveFirstAdminAuthData(), [])
      }),
  )
})

Deno.test('resolveFirstAdminAuthData: empty with only FIRST_ADMIN_EMAIL set', async () => {
  await withEnv(
    FIRST_ADMIN_EMAIL_ENV,
    'admin@example.com',
    () =>
      withEnv(FIRST_ADMIN_PASSWORD_ENV, undefined, async () => {
        assertEquals(await resolveFirstAdminAuthData(), [])
      }),
  )
})

Deno.test('resolveFirstAdminAuthData: seeds the fixed-id account, linked to FIRST_ADMIN_USER_ID and SUPERADMIN_ROLE_ID, once both are set', async () => {
  await withEnv(
    FIRST_ADMIN_EMAIL_ENV,
    'admin@example.com',
    () =>
      withEnv(FIRST_ADMIN_PASSWORD_ENV, 'Sup3rSecret!', async () => {
        const data = await resolveFirstAdminAuthData()
        assertEquals(data.length, 1)
        assertEquals(data[0], {
          id: FIRST_ADMIN_AUTH_ID,
          email: 'admin@example.com',
          emailKeyId: await computeEmailKeyId('admin@example.com'),
          password: 'Sup3rSecret!',
          userId: FIRST_ADMIN_USER_ID,
          roleIds: [SUPERADMIN_ROLE_ID],
        })
      }),
  )
})
