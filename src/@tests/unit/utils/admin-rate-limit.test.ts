import { assertEquals } from 'jsr:@std/assert@0.224'

import { AdminLookupRateLimit, AdminMutationRateLimit } from 'utils/admin-rate-limit.ts'
import { definedOnly } from 'utils/defined-only.ts'

Deno.test('AdminMutationRateLimit: is a method decorator', () => {
  assertEquals(typeof AdminMutationRateLimit(), 'function')
})

Deno.test('definedOnly: drops undefined values and keeps every other one, falsy included', () => {
  assertEquals(definedOnly({ a: undefined, b: 0, c: '', d: false, e: null, f: 'x' }), {
    b: 0,
    c: '',
    d: false,
    e: null,
    f: 'x',
  })
})

Deno.test('AdminLookupRateLimit: is a method decorator', () => {
  assertEquals(typeof AdminLookupRateLimit(), 'function')
})
