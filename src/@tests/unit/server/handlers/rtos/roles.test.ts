import { assertEquals } from 'jsr:@std/assert@0.224'
import {
  AccountRolesRTO,
  AssignRoleRTO,
  AuthIdParamsRTO,
  CreateRoleRTO,
  EditRoleRTO,
  RoleIdParamsRTO,
  SearchRolesRTO,
  SetRolesRTO,
} from 'server/handlers/rtos/roles.ts'
import { MAX_PERMISSIONS_PER_ROLE, MAX_ROLE_IDS_PER_REQUEST } from 'utils/constants.ts'
import { EditPermissionRTO } from 'server/handlers/rtos/permissions.ts'
import { hasAtMostItems } from 'server/handlers/rtos/validations/max-items.ts'
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

Deno.test('AccountRolesRTO/SetRolesRTO/AuthIdParamsRTO: ids must be ObjectIds, SetRolesRTO may be empty', async () => {
  const add = await validate(AccountRolesRTO, { authId: OID, roleIds: [OID] })
  assertEquals([add.authId, add.roleIds], [OID, [OID]])
  assertEquals((await validate(AuthIdParamsRTO, { authId: OID })).authId, OID)
  assertEquals((await validate(SetRolesRTO, { roleIds: [OID, OID] })).roleIds, [OID, OID])
  assertEquals((await validate(SetRolesRTO, { roleIds: [] })).roleIds, [])
})

Deno.test('AccountRolesRTO/SetRolesRTO: an absent, malformed or empty roleIds is rejected', async () => {
  await assertInvalid(AccountRolesRTO, { authId: 'a', roleIds: ['r'] }, ['authId', 'roleIds'])
  await assertInvalid(AccountRolesRTO, { authId: OID, roleIds: [OID, 'not-an-id'] }, ['roleIds'])
  await assertInvalid(AccountRolesRTO, { authId: OID }, ['roleIds'])
  await assertInvalid(AccountRolesRTO, { authId: OID, roleIds: [] }, ['roleIds'])
  await assertInvalid(SetRolesRTO, {}, ['roleIds'])
  await assertInvalid(SetRolesRTO, { roleIds: ['r'] }, ['roleIds'])
  await assertInvalid(SetRolesRTO, { roleIds: [OID, 'zz'] }, ['roleIds'])
})

Deno.test('AccountRolesRTO/SetRolesRTO: more than MAX_ROLE_IDS_PER_REQUEST ids is rejected', async () => {
  const atCap = Array(MAX_ROLE_IDS_PER_REQUEST).fill(OID)
  const overCap = Array(MAX_ROLE_IDS_PER_REQUEST + 1).fill(OID)
  assertEquals(
    (await validate(AccountRolesRTO, { authId: OID, roleIds: atCap })).roleIds.length,
    50,
  )
  assertEquals((await validate(SetRolesRTO, { roleIds: atCap })).roleIds.length, 50)
  await assertInvalid(AccountRolesRTO, { authId: OID, roleIds: overCap }, ['roleIds'])
  await assertInvalid(SetRolesRTO, { roleIds: overCap }, ['roleIds'])
})

const validRole = {
  name: 'Support agent',
  code: 'support-agent',
  description: 'Answers customers',
  permissions: [OID],
}

Deno.test('CreateRoleRTO: name, code and description follow the strict shapes', async () => {
  assertEquals((await validate(CreateRoleRTO, validRole)).code, 'support-agent')
  for (const code of ['presenza:seller', 'a.b_c-d', 'ab']) {
    // deno-lint-ignore no-await-in-loop
    assertEquals((await validate(CreateRoleRTO, { ...validRole, code })).code, code)
  }
  for (const code of ['A', 'Upper', 'two words', '-lead', 'trail-', 'a--b', 'x'.repeat(65), '']) {
    // deno-lint-ignore no-await-in-loop
    await assertInvalid(CreateRoleRTO, { ...validRole, code }, ['code'])
  }
})

Deno.test('CreateRoleRTO: text with control, bidirectional or zero-width characters, or edge spaces, is rejected', async () => {
  const hostile = [
    'Admin‮evil', // right-to-left override
    'Ad​min', // zero-width space
    'Ad⁦min', // isolate
    'Line\nbreak',
    ' leading',
    'trailing ',
    'tab\there',
    'x'.repeat(81),
    'a',
    '',
  ]
  for (const name of hostile) {
    // deno-lint-ignore no-await-in-loop
    await assertInvalid(CreateRoleRTO, { ...validRole, name }, ['name'])
  }
  for (const description of ['Bell\u0007', 'x'.repeat(501), '']) {
    // deno-lint-ignore no-await-in-loop
    await assertInvalid(CreateRoleRTO, { ...validRole, description }, ['description'])
  }
  // Accents and non-Latin scripts are ordinary text.
  assertEquals(
    (await validate(CreateRoleRTO, { ...validRole, name: 'Atención al cliente' })).name,
    'Atención al cliente',
  )
  assertEquals(
    (await validate(CreateRoleRTO, { ...validRole, name: '運営チーム' })).name,
    '運営チーム',
  )
})

Deno.test('CreateRoleRTO/EditRoleRTO: a role carries at most MAX_PERMISSIONS_PER_ROLE permissions', async () => {
  const atCap = Array(MAX_PERMISSIONS_PER_ROLE).fill(OID)
  const overCap = Array(MAX_PERMISSIONS_PER_ROLE + 1).fill(OID)
  assertEquals(
    (await validate(CreateRoleRTO, { ...validRole, permissions: atCap })).permissions.length,
    200,
  )
  assertEquals((await validate(CreateRoleRTO, { ...validRole, permissions: [] })).permissions, [])
  assertEquals((await validate(EditRoleRTO, { permissions: atCap })).permissions?.length, 200)
  await assertInvalid(CreateRoleRTO, { ...validRole, permissions: overCap }, ['permissions'])
  await assertInvalid(EditRoleRTO, { permissions: overCap }, ['permissions'])
  await assertInvalid(CreateRoleRTO, { ...validRole, permissions: [OID, 'nope'] }, ['permissions'])
})

Deno.test('CreateRoleRTO: isSystem is an optional boolean', async () => {
  assertEquals((await validate(CreateRoleRTO, validRole)).isSystem, undefined)
  assertEquals((await validate(CreateRoleRTO, { ...validRole, isSystem: true })).isSystem, true)
  await assertInvalid(CreateRoleRTO, { ...validRole, isSystem: 'yes' }, ['isSystem'])
})

Deno.test('EditRoleRTO: every field is optional and the same shapes apply when given', async () => {
  const empty = await validate(EditRoleRTO, {})
  assertEquals([empty.name, empty.description, empty.permissions, empty.updatedAt], [
    undefined,
    undefined,
    undefined,
    undefined,
  ])
  await assertInvalid(EditRoleRTO, { name: 'Bad​name', description: 'ok\nno' }, [
    'name',
    'description',
  ])
})

Deno.test('EditRoleRTO / EditPermissionRTO: updatedAt is the ISO instant the client read, or absent', async () => {
  for (const updatedAt of ['2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00Z']) {
    // deno-lint-ignore no-await-in-loop
    assertEquals((await validate(EditRoleRTO, { updatedAt })).updatedAt, updatedAt)
    // deno-lint-ignore no-await-in-loop
    assertEquals((await validate(EditPermissionRTO, { updatedAt })).updatedAt, updatedAt)
  }
  for (const updatedAt of ['yesterday', '2026-01-01', '2026-01-01T00:00:00+02:00', '']) {
    // deno-lint-ignore no-await-in-loop
    await assertInvalid(EditRoleRTO, { updatedAt }, ['updatedAt'])
    // deno-lint-ignore no-await-in-loop
    await assertInvalid(EditPermissionRTO, { updatedAt }, ['updatedAt'])
  }
})

Deno.test('MaxItems: an array of at most max elements, empty included, and nothing else', () => {
  assertEquals(hasAtMostItems([], 2), true)
  assertEquals(hasAtMostItems([1, 2], 2), true)
  assertEquals(hasAtMostItems([1, 2, 3], 2), false)
  assertEquals(hasAtMostItems('ab', 2), false)
  assertEquals(hasAtMostItems(undefined, 2), false)
})
