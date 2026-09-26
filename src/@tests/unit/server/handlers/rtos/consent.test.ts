import { assertEquals } from 'jsr:@std/assert@0.224'
import { ConsentRTO } from 'server/handlers/rtos/consent.ts'
import { assertInvalid, validate } from '../../../helpers/rto.ts'

Deno.test('ConsentRTO: requires a boolean accepted flag', async () => {
  assertEquals((await validate(ConsentRTO, { accepted: true })).accepted, true)
  assertEquals((await validate(ConsentRTO, { accepted: false })).accepted, false)
  await assertInvalid(ConsentRTO, {}, ['accepted'])
})
