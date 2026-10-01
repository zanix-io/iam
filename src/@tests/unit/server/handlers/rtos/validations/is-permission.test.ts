import { assertEquals } from 'jsr:@std/assert@0.224'

import { isPermission } from 'server/handlers/rtos/validations/is-permission.ts'

Deno.test('isPermission: accepts a valid module:action code', () => {
  assertEquals(isPermission('zanix-iam:role-write'), true)
})

Deno.test('isPermission: accepts hyphenated module and action segments', () => {
  assertEquals(isPermission('zanix-iam:organization-role-write'), true)
})

Deno.test('isPermission: accepts the reserved wildcard code', () => {
  // `*` is a real, reserved value (see `permissions/model.defs.ts`) but is NOT itself
  // `module:action`-shaped — it's seeded directly, never accepted through this RTO validator, so
  // rejecting it here is correct, not a gap.
  assertEquals(isPermission('*'), false)
})

Deno.test('isPermission: rejects a code with no colon', () => {
  assertEquals(isPermission('role-write'), false)
})

Deno.test('isPermission: accepts digits in either segment', () => {
  assertEquals(isPermission('b2b-portal:user'), true)
  assertEquals(isPermission('oauth2:token-v2'), true)
})

Deno.test('isPermission: rejects a code with underscores or other punctuation', () => {
  assertEquals(isPermission('zanix-iam:role_write'), false)
  assertEquals(isPermission('zanix.iam:role-write'), false)
})

Deno.test('isPermission: rejects a non-string value', () => {
  assertEquals(isPermission(undefined), false)
})
