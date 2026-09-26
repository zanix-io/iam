import { assertEquals } from 'jsr:@std/assert@0.224'

import seedersProd, {
  FIRST_ADMIN_USER_ID,
  resolveFirstAdminUserData,
} from 'server/repositories/users/seeders/seeders.prod.ts'
import { FIRST_ADMIN_EMAIL_ENV, FIRST_ADMIN_PASSWORD_ENV } from 'utils/constants.ts'

function withEnv(name: string, value: string | undefined, run: () => void) {
  const original = Deno.env.get(name)
  if (value === undefined) Deno.env.delete(name)
  else Deno.env.set(name, value)
  try {
    run()
  } finally {
    if (original === undefined) Deno.env.delete(name)
    else Deno.env.set(name, original)
  }
}

/**
 * `seedersProd`'s own default export reads `resolveFirstAdminUserData()` once, at module-load
 * time (same limitation `constants.test.ts`'s `TOKEN_EXPIRATION` tests already document) — this
 * test file loads it with neither env var set (the empty default). The configured default export
 * is covered in `../first-admin-seeders-configured.test.ts`; everything else runs directly against
 * `resolveFirstAdminUserData()`, a pure function of the current environment.
 */
Deno.test('seeders.prod (users): empty when FIRST_ADMIN_EMAIL/FIRST_ADMIN_PASSWORD are unset', () => {
  assertEquals(Deno.env.get(FIRST_ADMIN_EMAIL_ENV), undefined)
  assertEquals(Deno.env.get(FIRST_ADMIN_PASSWORD_ENV), undefined)
  assertEquals(seedersProd, [])
})

Deno.test('resolveFirstAdminUserData: empty with neither env var set', () => {
  withEnv(FIRST_ADMIN_EMAIL_ENV, undefined, () => {
    withEnv(FIRST_ADMIN_PASSWORD_ENV, undefined, () => {
      assertEquals(resolveFirstAdminUserData(), [])
    })
  })
})

Deno.test('resolveFirstAdminUserData: empty with only FIRST_ADMIN_EMAIL set', () => {
  withEnv(FIRST_ADMIN_EMAIL_ENV, 'admin@example.com', () => {
    withEnv(FIRST_ADMIN_PASSWORD_ENV, undefined, () => {
      assertEquals(resolveFirstAdminUserData(), [])
    })
  })
})

Deno.test('resolveFirstAdminUserData: empty with only FIRST_ADMIN_PASSWORD set', () => {
  withEnv(FIRST_ADMIN_EMAIL_ENV, undefined, () => {
    withEnv(FIRST_ADMIN_PASSWORD_ENV, 'Sup3rSecret!', () => {
      assertEquals(resolveFirstAdminUserData(), [])
    })
  })
})

Deno.test('resolveFirstAdminUserData: seeds the fixed-id bootstrap profile once both are set', () => {
  withEnv(FIRST_ADMIN_EMAIL_ENV, 'admin@example.com', () => {
    withEnv(FIRST_ADMIN_PASSWORD_ENV, 'Sup3rSecret!', () => {
      assertEquals(resolveFirstAdminUserData(), [{ id: FIRST_ADMIN_USER_ID }])
    })
  })
})
