import { assertEquals } from 'jsr:@std/assert@0.224'
import seeders, {
  SEEDED_PERMISSIONS,
  seedMissingPermissions,
} from 'server/repositories/permissions/seeders/seeders.prod.ts'
import { RBAC_PERMISSIONS } from 'utils/constants.ts'

Deno.test('permissions seeder: seeds the wildcard plus every RBAC_PERMISSIONS code', () => {
  const codes = SEEDED_PERMISSIONS.map((permission) => permission.code).sort()
  assertEquals(codes, ['*', ...Object.values(RBAC_PERMISSIONS)].sort())
})

Deno.test('permissions seeder: every seeded id is unique', () => {
  const ids = SEEDED_PERMISSIONS.map((permission) => permission.id)
  assertEquals(new Set(ids).size, ids.length)
})

const AUDIT_READ =
  SEEDED_PERMISSIONS.map((p) => p.code).find((code) => code.endsWith(':audit-read')) ?? ''

type Seeded = { id: string; code: string }
type FakeModel = {
  find: (filter: { code: { $in: string[] } }) => { lean: () => Promise<unknown[]> }
  upsertManyById: (data: Seeded[]) => Promise<void>
}

function fakeModel(existing: { _id: string; code: string }[], inserted: Seeded[][]): FakeModel {
  return {
    find: (filter) => ({
      lean: () => Promise.resolve(existing.filter((p) => filter.code.$in.includes(p.code))),
    }),
    upsertManyById: (data) => {
      inserted.push(data)
      return Promise.resolve()
    },
  }
}

Deno.test('permissions seeder: has its own version so databases that ran 1.1.0 receive new codes', () => {
  const [seeder] = seeders as unknown as { options: { name: string; version: string } }[]
  assertEquals(seeder.options.name, 'seedMissingPermissions')
  assertEquals(seeder.options.version, '1.2.0')
})

Deno.test('permissions seeder: inserts only what is missing', async () => {
  const inserted: Seeded[][] = []
  const present = SEEDED_PERMISSIONS.filter((p) => !p.code.endsWith(':audit-read'))
  await seedMissingPermissions(
    fakeModel(present.map((p) => ({ _id: p.id, code: p.code })), inserted) as never,
  )
  assertEquals(inserted.length, 1)
  assertEquals(inserted[0].map((p) => p.code), [AUDIT_READ])
})

Deno.test('permissions seeder: writes nothing when everything is there', async () => {
  const inserted: Seeded[][] = []
  await seedMissingPermissions(
    fakeModel(SEEDED_PERMISSIONS.map((p) => ({ _id: p.id, code: p.code })), inserted) as never,
  )
  assertEquals(inserted, [])
})

Deno.test('permissions seeder: a code created by hand under another id is kept and the seeded one skipped', async () => {
  const inserted: Seeded[][] = []
  const present = SEEDED_PERMISSIONS.filter((p) => !p.code.endsWith(':audit-read'))
    .map((p) => ({ _id: p.id, code: p.code }))
  present.push({ _id: '6a00000000000000000000aa', code: AUDIT_READ })
  await seedMissingPermissions(fakeModel(present, inserted) as never)
  assertEquals(inserted, [])
})
