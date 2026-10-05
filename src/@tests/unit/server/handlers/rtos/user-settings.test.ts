import { assertEquals } from 'jsr:@std/assert@0.224'
import {
  AdminEditUserRTO,
  LookupUserRTO,
  SearchUsersRTO,
  UserIdParamsRTO,
  UserProfileRTO,
  UserRegisterRTO,
} from 'server/handlers/rtos/user-settings.ts'
import { assertInvalid, validate } from '../../../helpers/rto.ts'

Deno.test('UserProfileRTO: every field optional; phoneNumber must be a phone number', async () => {
  const rto = await validate(UserProfileRTO, { firstName: 'Jane', phoneNumber: '+14155551234' })
  assertEquals([rto.firstName, rto.lastName, rto.phoneNumber], ['Jane', undefined, '+14155551234'])
  await assertInvalid(UserProfileRTO, { phoneNumber: 'call me' }, ['phoneNumber'])
})

Deno.test('UserRegisterRTO: requires an email; password is optional (passwordless accounts)', async () => {
  const rto = await validate(UserRegisterRTO, { email: 'jane@example.com', firstName: 'Jane' })
  assertEquals([rto.email, rto.password, rto.firstName], ['jane@example.com', undefined, 'Jane'])
  await assertInvalid(UserRegisterRTO, { email: 'jane' }, ['email'])
})

Deno.test('AdminEditUserRTO: status is limited to the admin-editable statuses', async () => {
  assertEquals((await validate(AdminEditUserRTO, { status: 'INACTIVE' })).status, 'INACTIVE')
  assertEquals((await validate(AdminEditUserRTO, { status: 'DELETED' })).status, 'DELETED')
  await assertInvalid(AdminEditUserRTO, { status: 'ACTIVE' }, ['status'])
  await assertInvalid(AdminEditUserRTO, { status: 'BANNED' }, ['status'])
})

Deno.test('UserIdParamsRTO: id must be an ObjectId', async () => {
  assertEquals(
    (await validate(UserIdParamsRTO, { id: '507f1f77bcf86cd799439011' })).id,
    '507f1f77bcf86cd799439011',
  )
  await assertInvalid(UserIdParamsRTO, { id: 'user-1' }, ['id'])
})

Deno.test('SearchUsersRTO: query and status are optional; status must be a known status', async () => {
  const rto = await validate(SearchUsersRTO, { status: 'DELETED' })
  assertEquals([rto.query, rto.status], [undefined, 'DELETED'])
  await assertInvalid(SearchUsersRTO, { status: 'BANNED' }, ['status'])
})

Deno.test('LookupUserRTO: a required email, trimmed before it is checked and bounded in length', async () => {
  assertEquals(
    (await validate(LookupUserRTO, { email: 'jane@example.com' })).email,
    'jane@example.com',
  )
  assertEquals(
    (await validate(LookupUserRTO, { email: '  Jane@Example.com ' })).email.trim(),
    'Jane@Example.com',
  )
  await assertInvalid(LookupUserRTO, {}, ['email'])
  await assertInvalid(LookupUserRTO, { email: '' }, ['email'])
  await assertInvalid(LookupUserRTO, { email: 'jane' }, ['email'])
  await assertInvalid(LookupUserRTO, { email: 'jane@@example.com' }, ['email'])
  await assertInvalid(LookupUserRTO, { email: 'jane@example.com, other@example.com' }, ['email'])
  await assertInvalid(LookupUserRTO, { email: `${'a'.repeat(250)}@example.com` }, ['email'])
})
