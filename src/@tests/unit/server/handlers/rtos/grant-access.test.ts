import { assert, assertEquals } from 'jsr:@std/assert@0.224'
import {
  CheckGrantAccessRTO,
  CreateGrantAccessRTO,
  EditGrantAccessRTO,
  GrantAccessIdParamsRTO,
  SearchGrantAccessRTO,
} from 'server/handlers/rtos/grant-access.ts'
import { assertInvalid, validate } from '../../../helpers/rto.ts'

const USER_ID = '507f1f77bcf86cd799439011'

Deno.test('CreateGrantAccessRTO: isActive defaults to true and expiresAt parses to a Date', async () => {
  const rto = await validate(CreateGrantAccessRTO, {
    userId: USER_ID,
    resourceId: 'billing:reports',
    accessLevel: 'read',
    expiresAt: '2030-01-01T00:00:00Z',
  })
  assertEquals(rto.isActive, true)
  assertEquals(rto.tenantId, undefined)
  assert(rto.expiresAt instanceof Date)
  assertEquals(rto.expiresAt.toISOString(), '2030-01-01T00:00:00.000Z')
})

Deno.test('CreateGrantAccessRTO: requires an ObjectId userId, a resourceId and an accessLevel', async () => {
  await assertInvalid(CreateGrantAccessRTO, { userId: 'user-1' }, [
    'userId',
    'resourceId',
    'accessLevel',
  ])
})

Deno.test('CreateGrantAccessRTO: rejects an unparseable expiresAt', async () => {
  await assertInvalid(CreateGrantAccessRTO, {
    userId: USER_ID,
    resourceId: 'r',
    accessLevel: 'read',
    expiresAt: 'someday',
  }, ['expiresAt'])
})

Deno.test('EditGrantAccessRTO: every field is optional; isActive must be a boolean', async () => {
  const rto = await validate(EditGrantAccessRTO, {})
  assertEquals([rto.accessLevel, rto.expiresAt, rto.isActive], [undefined, undefined, undefined])
  await assertInvalid(EditGrantAccessRTO, { isActive: 'yes' }, ['isActive'])
})

Deno.test('GrantAccessIdParamsRTO: id must be an ObjectId', async () => {
  assertEquals((await validate(GrantAccessIdParamsRTO, { id: USER_ID })).id, USER_ID)
  await assertInvalid(GrantAccessIdParamsRTO, { id: 'grant-1' }, ['id'])
})

Deno.test('SearchGrantAccessRTO: filters are optional; userId must be an ObjectId when given', async () => {
  const rto = await validate(SearchGrantAccessRTO, { resourceId: 'r', tenantId: 't' })
  assertEquals([rto.userId, rto.resourceId, rto.tenantId], [undefined, 'r', 't'])
  await assertInvalid(SearchGrantAccessRTO, { userId: 'user-1' }, ['userId'])
})

Deno.test('CheckGrantAccessRTO: requires userId, resourceId and accessLevel; tenantId optional', async () => {
  const rto = await validate(CheckGrantAccessRTO, {
    userId: USER_ID,
    resourceId: 'r',
    accessLevel: 'read',
  })
  assertEquals(rto.tenantId, undefined)
  await assertInvalid(CheckGrantAccessRTO, {}, ['userId', 'resourceId', 'accessLevel'])
})
