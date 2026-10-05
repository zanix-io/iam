import { assertEquals } from 'jsr:@std/assert@0.224'

import seeders, { SUPERADMIN_ROLE_ID } from 'server/repositories/roles/seeders/seeders.prod.ts'

type StubModel = { upsertManyById: (data: Record<string, unknown>[]) => Promise<void> }

Deno.test('roles seeder: the superadmin role is a system role holding only the wildcard', async () => {
  let seeded: Record<string, unknown>[] = []
  const [seeder] = seeders as unknown as { handler: (model: StubModel) => Promise<void> }[]
  await seeder.handler({
    upsertManyById: (data) => {
      seeded = data
      return Promise.resolve()
    },
  })
  assertEquals(seeded.length, 1)
  assertEquals(seeded[0].id, SUPERADMIN_ROLE_ID)
  assertEquals(seeded[0].code, 'superadmin')
  assertEquals(seeded[0].isSystem, true)
})
