import { assertEquals } from 'jsr:@std/assert@0.224'
import { createAppToken, JWK_PUB_ENV } from '@zanix/auth'

import { mintStepUpToken, verifyStepUpToken } from 'utils/step-up-token.ts'
import { stepUpTestKeys, withStepUpKeys } from '../helpers/step-up.ts'

const expected = { subject: 'auth-1', purpose: 'factor-change', bind: 'totp-disable' }
const mint = (overrides: Partial<Parameters<typeof mintStepUpToken>[0]> = {}) =>
  mintStepUpToken({
    subject: 'auth-1',
    purpose: 'factor-change',
    method: 'otp',
    bind: 'totp-disable',
    ...overrides,
  })

Deno.test('verifyStepUpToken: a token minted for the expectation yields its jti and exp', () =>
  withStepUpKeys(async () => {
    const { stepUpToken, expiresAt } = await mint()
    const claims = await verifyStepUpToken(stepUpToken, expected)
    assertEquals(claims?.exp, expiresAt)
    assertEquals(typeof claims?.jti, 'string')
  }))

Deno.test('verifyStepUpToken: a wrong subject, purpose or bind, or a token without a bind, is refused', () =>
  withStepUpKeys(async () => {
    const cases = [
      await mint({ subject: 'auth-2' }),
      await mint({ purpose: 'wallet-transfer' }),
      await mint({ bind: 'totp-confirm' }),
      await mint({ bind: undefined }),
    ]
    for (const { stepUpToken } of cases) {
      // deno-lint-ignore no-await-in-loop
      assertEquals(await verifyStepUpToken(stepUpToken, expected), undefined)
    }
  }))

Deno.test('verifyStepUpToken: a token that is not a step-up token (no typ/aud) is refused even when signed by the same key', () =>
  withStepUpKeys(async () => {
    const token = await createAppToken({
      subject: 'auth-1',
      type: 'api',
      expiration: 300,
      payload: { purpose: 'factor-change', bind: 'totp-disable' },
    })
    assertEquals(await verifyStepUpToken(token, expected), undefined)
  }))

Deno.test('verifyStepUpToken: garbage, a tampered signature and an unconfigured public key are refused', () =>
  withStepUpKeys(async () => {
    const { stepUpToken } = await mint()
    assertEquals(await verifyStepUpToken('garbage', expected), undefined)
    assertEquals(await verifyStepUpToken(`${stepUpToken.slice(0, -4)}AAAA`, expected), undefined)

    const saved = Deno.env.get(JWK_PUB_ENV)
    Deno.env.delete(JWK_PUB_ENV)
    try {
      assertEquals(await verifyStepUpToken(stepUpToken, expected), undefined)
    } finally {
      if (saved !== undefined) Deno.env.set(JWK_PUB_ENV, saved)
    }
  }))

Deno.test('verifyStepUpToken: a token signed by another key pair is refused', async () => {
  const { stepUpToken } = await withStepUpKeys(() => mint())
  const { generateRSAKeys } = await import('@zanix/helpers')
  const other = await generateRSAKeys()
  const saved = Deno.env.get(JWK_PUB_ENV)
  Deno.env.set(JWK_PUB_ENV, btoa(other.publicKey))
  try {
    assertEquals(await verifyStepUpToken(stepUpToken, expected), undefined)
  } finally {
    if (saved === undefined) Deno.env.delete(JWK_PUB_ENV)
    else Deno.env.set(JWK_PUB_ENV, saved)
  }
  assertEquals(typeof stepUpTestKeys.publicKey, 'string')
})
