import { assertEquals } from 'jsr:@std/assert@0.224'

Deno.test('permissionsForRoleIds: one roles query merged into one list; no roles asks nothing', async () => {
  const { permissionsForAccount, permissionsForRoleIds } = await import(
    'server/interactors/session-permissions.ts'
  )
  const { RolesRepository } = await import('server/repositories/roles/entity.provider.ts')
  const queries: string[][] = []
  const providers = {
    get: (provider: unknown) => {
      if (provider !== RolesRepository) throw new Error('[test] unexpected provider')
      return {
        findManyWithPermissions: (ids: string[]) => {
          queries.push(ids)
          return ids.map((id) => ({
            id,
            permissions: [{ id: 'p', code: 'web:user', isActive: true }, {
              id: id,
              code: `${id}:use`,
              isActive: true,
            }],
          }))
        },
      }
    },
  }
  assertEquals(await permissionsForRoleIds(providers as never, ['a', 'b']), [
    'web:user',
    'a:use',
    'b:use',
  ])
  assertEquals(await permissionsForRoleIds(providers as never, []), [])
  // An account written with roleIds, or none at all.
  assertEquals((await permissionsForAccount(providers as never, { roleIds: ['c'] })).length, 2)
  assertEquals(await permissionsForAccount(providers as never, undefined), [])
  assertEquals(queries, [['a', 'b'], ['c']])
})
