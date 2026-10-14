import { assertEquals } from 'jsr:@std/assert@0.224'
import { StepUpRequestRTO, StepUpVerifyRTO } from 'server/handlers/rtos/step-up.ts'
import { assertInvalid, validate } from '../../../helpers/rto.ts'

Deno.test('StepUpRequestRTO: accepts lowercase letters, digits and hyphens up to 64 characters', async () => {
  assertEquals(
    (await validate(StepUpRequestRTO, { purpose: 'wallet-transfer-2' })).purpose,
    'wallet-transfer-2',
  )
  assertEquals((await validate(StepUpRequestRTO, { purpose: 'a'.repeat(64) })).purpose.length, 64)
})

Deno.test('StepUpRequestRTO: rejects an empty, uppercase, spaced, colon-bearing or too long purpose', async () => {
  for (
    const purpose of [
      '',
      'Wallet',
      'wallet transfer',
      'wallet:transfer',
      'wallet_transfer',
      'a'.repeat(65),
    ]
  ) {
    // deno-lint-ignore no-await-in-loop
    await assertInvalid(StepUpRequestRTO, { purpose }, ['purpose'])
  }
  await assertInvalid(StepUpRequestRTO, {}, ['purpose'])
})

Deno.test('StepUpVerifyRTO: requires purpose and code; bind is optional', async () => {
  const withBind = await validate(StepUpVerifyRTO, {
    purpose: 'wallet-transfer',
    code: '123456',
    bind: 'tx 42/ref',
  })
  assertEquals([withBind.purpose, withBind.code, withBind.bind], [
    'wallet-transfer',
    '123456',
    'tx 42/ref',
  ])
  assertEquals(
    (await validate(StepUpVerifyRTO, { purpose: 'wallet-transfer', code: '1' })).bind,
    undefined,
  )
  await assertInvalid(StepUpVerifyRTO, {}, ['purpose', 'code'])
})

Deno.test('StepUpVerifyRTO: rejects a bind that is non-ASCII, multi-line or longer than 256 characters', async () => {
  for (const bind of ['tx-ñ', 'a'.repeat(257), 'line\nbreak']) {
    // deno-lint-ignore no-await-in-loop
    await assertInvalid(StepUpVerifyRTO, { purpose: 'wallet-transfer', code: '1', bind }, ['bind'])
  }
})

Deno.test('StepUpVerifyRTO: an empty bind is read as no bind', async () => {
  const rto = await validate(StepUpVerifyRTO, { purpose: 'wallet-transfer', code: '1', bind: '' })
  assertEquals(rto.bind, undefined)
})
