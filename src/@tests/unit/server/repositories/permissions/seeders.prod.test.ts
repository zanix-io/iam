import { assertEquals } from 'jsr:@std/assert@0.224'
import { SEEDED_PERMISSIONS } from 'server/repositories/permissions/seeders/seeders.prod.ts'
import { RBAC_PERMISSIONS } from 'utils/constants.ts'

Deno.test('permissions seeder: seeds the wildcard plus every RBAC_PERMISSIONS code', () => {
  const codes = SEEDED_PERMISSIONS.map((permission) => permission.code).sort()
  assertEquals(codes, ['*', ...Object.values(RBAC_PERMISSIONS)].sort())
})

Deno.test('permissions seeder: every seeded id is unique', () => {
  const ids = SEEDED_PERMISSIONS.map((permission) => permission.id)
  assertEquals(new Set(ids).size, ids.length)
})
