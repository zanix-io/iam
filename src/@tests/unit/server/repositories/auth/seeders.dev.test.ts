import { assertEquals } from 'jsr:@std/assert@0.224'

import seedersDev, {
  DEV_AUTH_EMAIL,
  DEV_AUTH_ID,
  DEV_AUTH_PASSWORD,
} from 'server/repositories/auth/seeders/seeders.dev.ts'
import { SUPERADMIN_ROLE_ID } from 'server/repositories/roles/seeders/seeders.prod.ts'
import { computeEmailKeyId } from 'server/repositories/auth/email-key.ts'
import { SERVICE_ID } from 'utils/constants.ts'

/**
 * `seedManyByIdIfMissing`'s own returned closure never exposes its seed data directly — the only
 * way to observe what it will actually write is to invoke it against a stub model and capture the
 * arguments passed to `upsertManyById`. Pure-function coverage over a closure, no real database or
 * registration involved, correctly `unit/` per `zanix-test-tier-conventions`.
 */
type StubModel = {
  upsertManyById: (
    data: Record<string, unknown>[],
    options: Record<string, unknown>,
  ) => Promise<void>
}
type SeederEntry = { handler: (model: StubModel) => Promise<void> }

Deno.test('seeders.dev: seeds the dev auth account with the superadmin roleIds', async () => {
  let capturedData: Record<string, unknown>[] | undefined
  let capturedOptions: Record<string, unknown> | undefined

  const stubModel: StubModel = {
    upsertManyById: (data, options) => {
      capturedData = data
      capturedOptions = options
      return Promise.resolve()
    },
  }

  const [seeder] = seedersDev as unknown as SeederEntry[]
  await seeder.handler(stubModel)

  assertEquals(capturedData?.length, 1)
  assertEquals(capturedData?.[0].id, DEV_AUTH_ID)
  // `DEV_AUTH_EMAIL` is derived from `SERVICE_ID` (defaults to `'zanix-iam'`), so this is
  // `'dev@zanix-iam.local'` in this test process — never a stale literal that would silently stop
  // matching `DEV_AUTH_EMAIL` if `SERVICE_ID` were ever overridden.
  assertEquals(capturedData?.[0].email, DEV_AUTH_EMAIL)
  assertEquals(DEV_AUTH_EMAIL, `dev@${SERVICE_ID}.local`)
  assertEquals(capturedData?.[0].emailKeyId, await computeEmailKeyId(DEV_AUTH_EMAIL))
  assertEquals(capturedData?.[0].password, DEV_AUTH_PASSWORD)
  assertEquals(capturedData?.[0].roleIds, [SUPERADMIN_ROLE_ID])
  // No 2FA state on this seed — must stay password-only, see `seeders.dev.ts`'s own doc.
  assertEquals(capturedData?.[0].twoFactorAuthConfig, undefined)
  assertEquals(capturedData?.[0].totpSecret, undefined)
  assertEquals(capturedOptions?.useDataPolicies, true)
})
