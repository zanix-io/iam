import { assertEquals } from 'jsr:@std/assert@0.224'
import {
  AssignRoleRTO,
  CreateRoleRTO,
  EditRoleRTO,
  RoleIdParamsRTO,
  SearchRolesRTO,
} from 'server/handlers/rtos/roles.ts'
import { assertInvalid, validate } from '../../../helpers/rto.ts'

const OID = '507f1f77bcf86cd799439011'

Deno.test('CreateRoleRTO: requires name/code/description and ObjectId permission ids', async () => {
  const rto = await validate(CreateRoleRTO, {
    name: 'Editor',
    code: 'editor',
    description: 'Edits content',
    permissions: [OID],
  })
  assertEquals([rto.tenantId, rto.permissions], [undefined, [OID]])
  await assertInvalid(CreateRoleRTO, { permissions: ['perm-1'] }, [
    'name',
    'code',
    'description',
    'permissions',
  ])
})

Deno.test('EditRoleRTO: every field optional; permissions must still be ObjectIds when given', async () => {
  assertEquals((await validate(EditRoleRTO, {})).permissions, undefined)
  await assertInvalid(EditRoleRTO, { permissions: ['perm-1'] }, ['permissions'])
})

Deno.test('RoleIdParamsRTO/AssignRoleRTO: ids must be ObjectIds', async () => {
  assertEquals((await validate(RoleIdParamsRTO, { id: OID })).id, OID)
  const assign = await validate(AssignRoleRTO, { authId: OID, roleId: OID })
  assertEquals([assign.authId, assign.roleId], [OID, OID])
  await assertInvalid(AssignRoleRTO, { authId: 'a', roleId: 'r' }, ['authId', 'roleId'])
})

Deno.test('SearchRolesRTO: query and tenantId are optional', async () => {
  const rto = await validate(SearchRolesRTO, { tenantId: 'tenant-1' })
  assertEquals([rto.query, rto.tenantId], [undefined, 'tenant-1'])
})
