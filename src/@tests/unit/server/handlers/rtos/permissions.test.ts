import { assertEquals } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'
import { assertRejects } from 'jsr:@std/assert@0.224'
import {
  CreatePermissionRTO,
  EditPermissionRTO,
  PermissionIdParamsRTO,
  SearchPermissionsRTO,
} from 'server/handlers/rtos/permissions.ts'
import { assertInvalid, validate } from '../../../helpers/rto.ts'

const base = { code: 'billing:invoice-read', name: 'Read invoices', description: 'Reads invoices' }

Deno.test('CreatePermissionRTO: a module:action code passes and isActive defaults to true', async () => {
  const rto = await validate(CreatePermissionRTO, { ...base, categories: ['billing'] })
  assertEquals([rto.code, rto.isActive, rto.categories], ['billing:invoice-read', true, [
    'billing',
  ]])
})

Deno.test('CreatePermissionRTO: @IsPermission rejects a code outside the module:action shape, with its own message', async () => {
  const error = await assertRejects(
    () => validate(CreatePermissionRTO, { ...base, code: 'invoice_read' }),
    HttpError,
  )
  const properties = (error.cause as { properties: Record<string, { constraints: string[] }[]> })
    .properties
  assertEquals(Object.keys(properties), ['code'])
  assertEquals(
    properties.code[0].constraints,
    [
      "The 'code' property must be a valid permission code in the 'module:action' format " +
      '(letters and hyphens only).',
    ],
  )
})

Deno.test('CreatePermissionRTO: every category must be a string', async () => {
  await assertInvalid(CreatePermissionRTO, { ...base, categories: ['ok', 3] }, ['categories'])
})

Deno.test('EditPermissionRTO: every field is optional', async () => {
  const rto = await validate(EditPermissionRTO, {})
  assertEquals([rto.name, rto.description, rto.categories, rto.isActive], [
    undefined,
    undefined,
    undefined,
    undefined,
  ])
  await assertInvalid(EditPermissionRTO, { isActive: 'no' }, ['isActive'])
})

Deno.test('PermissionIdParamsRTO/SearchPermissionsRTO: id is an ObjectId; query is optional', async () => {
  assertEquals(
    (await validate(PermissionIdParamsRTO, { id: '507f1f77bcf86cd799439011' })).id,
    '507f1f77bcf86cd799439011',
  )
  await assertInvalid(PermissionIdParamsRTO, { id: 'perm-1' }, ['id'])
  assertEquals((await validate(SearchPermissionsRTO, {})).query, undefined)
})
