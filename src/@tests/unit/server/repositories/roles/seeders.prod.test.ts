import { assertEquals } from 'jsr:@std/assert@0.224'

import seeders, {
  markSuperadminAsSystem,
  SUPERADMIN_ROLE_ID,
} from 'server/repositories/roles/seeders/seeders.prod.ts'

type StubModel = { upsertManyById: (data: Record<string, unknown>[]) => Promise<void> }
type Entry = {
  handler: (model: never) => Promise<void>
  options: { name?: string; version: string }
}

Deno.test('roles seeder: the superadmin role is a system role holding only the wildcard', async () => {
  let seeded: Record<string, unknown>[] = []
  const [seeder] = seeders as unknown as Entry[]
  await seeder.handler({
    upsertManyById: (data) => {
      seeded = data
      return Promise.resolve()
    },
  } as StubModel as never)
  assertEquals(seeded.length, 1)
  assertEquals(seeded[0].id, SUPERADMIN_ROLE_ID)
  assertEquals(seeded[0].code, 'superadmin')
  assertEquals(seeded[0].isSystem, true)
})

Deno.test('roles seeder: a second seeder marks an existing superadmin, under its own version', () => {
  const entries = seeders as unknown as Entry[]
  assertEquals(entries.length, 2)
  assertEquals(entries[1].options, { name: 'markSuperadminAsSystem', version: '1.1.0' })
})

Deno.test('roles seeder: marking writes only when isSystem is missing, touching nothing else', async () => {
  const calls: unknown[][] = []
  await markSuperadminAsSystem({
    updateOne: (...args) => {
      calls.push(args)
      return Promise.resolve()
    },
  })
  assertEquals(calls, [[
    { _id: SUPERADMIN_ROLE_ID, isSystem: { $exists: false } },
    { $set: { isSystem: true } },
    { overwriteImmutable: true, timestamps: false },
  ]])
})
