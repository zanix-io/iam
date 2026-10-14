import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { createAppToken, createJWT, decodeJWT, JWT_KEY_ENV, verifyJWT } from '@zanix/auth'
import { InternalError, PermissionDenied } from '@zanix/errors'
import { STEP_UP_TOKEN_TTL_SECONDS } from 'utils/constants.ts'
import { STEP_UP_TOKEN_AUDIENCE, STEP_UP_TOKEN_TYPE } from 'utils/shared-enums.ts'
import { mintStepUpToken } from 'utils/step-up-token.ts'
import { verifyStepUpToken, withStepUpKeys } from '../helpers/step-up.ts'

const input = { subject: 'auth-1', purpose: 'wallet-transfer', method: 'otp' } as const

Deno.test('mintStepUpToken: carries sub, purpose, method, typ, aud, jti, iat and a five-minute exp', () =>
  withStepUpKeys(async () => {
    const { stepUpToken, expiresAt } = await mintStepUpToken({ ...input, bind: 'tx-42' })
    const { header, payload } = decodeJWT(stepUpToken)

    assertEquals(header.alg, 'RS256')
    assertEquals(payload.sub, 'auth-1')
    assertEquals(payload.purpose, 'wallet-transfer')
    assertEquals(payload.method, 'otp')
    assertEquals(payload.bind, 'tx-42')
    assertEquals(payload.typ, STEP_UP_TOKEN_TYPE)
    assertEquals(payload.aud, STEP_UP_TOKEN_AUDIENCE)
    assert(typeof payload.jti === 'string' && payload.jti.length > 0)
    assertEquals((payload.exp ?? 0) - (payload.iat ?? 0), STEP_UP_TOKEN_TTL_SECONDS)
    assertEquals(STEP_UP_TOKEN_TTL_SECONDS, 300)
    assertEquals(expiresAt, payload.exp)
  }))

Deno.test('mintStepUpToken: omits bind when none is given and echoes the totp method', () =>
  withStepUpKeys(async () => {
    const { stepUpToken } = await mintStepUpToken({ ...input, method: 'totp' })
    const { payload } = decodeJWT(stepUpToken)
    assertEquals('bind' in payload, false)
    assertEquals(payload.method, 'totp')
  }))

Deno.test('mintStepUpToken: every token has its own jti', () =>
  withStepUpKeys(async () => {
    const [first, second] = await Promise.all([mintStepUpToken(input), mintStepUpToken(input)])
    assert(decodeJWT(first.stepUpToken).payload.jti !== decodeJWT(second.stepUpToken).payload.jti)
  }))

Deno.test('mintStepUpToken: a service verifies it with the public key, subject, purpose and bind', () =>
  withStepUpKeys(async () => {
    const { stepUpToken } = await mintStepUpToken({ ...input, bind: 'tx-42' })
    const payload = await verifyStepUpToken(stepUpToken, { ...input, bind: 'tx-42' })
    assertEquals(payload.sub, 'auth-1')

    await assertRejects(
      () => verifyStepUpToken(stepUpToken, { ...input, purpose: 'other-purpose' }),
      Error,
      'wrong purpose',
    )
    await assertRejects(
      () => verifyStepUpToken(stepUpToken, { ...input, subject: 'auth-2' }),
      Error,
      'wrong subject',
    )
    await assertRejects(
      () => verifyStepUpToken(stepUpToken, { ...input, bind: 'tx-43' }),
      Error,
      'wrong bind',
    )
  }))

Deno.test('mintStepUpToken: a tampered payload fails the signature check', () =>
  withStepUpKeys(async () => {
    const { stepUpToken } = await mintStepUpToken(input)
    const [header, payload, signature] = stepUpToken.split('.')
    const forged = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    forged.purpose = 'other-purpose'
    const encoded = btoa(JSON.stringify(forged)).replace(/\+/g, '-').replace(/\//g, '_')
      .replace(/=+$/, '')
    await assertRejects(
      () =>
        verifyStepUpToken(`${header}.${encoded}.${signature}`, {
          ...input,
          purpose: 'other-purpose',
        }),
      Error,
    )
  }))

Deno.test('step-up token vs access token: a user access token (HS256) never passes as a step-up token', () =>
  withStepUpKeys(async () => {
    const original = Deno.env.get(JWT_KEY_ENV)
    Deno.env.set(JWT_KEY_ENV, 'step-up-test-jwt-key')
    try {
      const accessToken = await createJWT(
        { sub: 'auth-1', aud: ['*'], typ: STEP_UP_TOKEN_TYPE, purpose: 'wallet-transfer' } as never,
        'step-up-test-jwt-key',
        { expiration: '1h' },
      )
      // Even an access token that copies every step-up claim fails the signature check.
      const error = await assertRejects(
        () => verifyStepUpToken(accessToken, input),
        PermissionDenied,
      )
      assertEquals(error.code, 'INVALID_TOKEN_SIGNATURE')
    } finally {
      if (original === undefined) Deno.env.delete(JWT_KEY_ENV)
      else Deno.env.set(JWT_KEY_ENV, original)
    }
  }))

Deno.test('step-up token vs service token: another token signed with the same RSA key is rejected for its claims', () =>
  withStepUpKeys(async () => {
    // An `api` token signed by the same key but minted for something else: the signature is valid,
    // so the audience and `typ` claims are what separate it.
    const serviceToken = await createAppToken({
      subject: 'auth-1',
      type: 'api',
      expiration: 300,
      payload: { permissions: ['wallet:admin'] },
    })
    const error = await assertRejects(
      () => verifyStepUpToken(serviceToken, input),
      PermissionDenied,
    )
    assertEquals(error.code, 'INVALID_TOKEN_PERMISSIONS')

    const wrongType = await createAppToken({
      subject: 'auth-1',
      type: 'api',
      expiration: 300,
      payload: { aud: STEP_UP_TOKEN_AUDIENCE, purpose: input.purpose },
    })
    await assertRejects(() => verifyStepUpToken(wrongType, input), Error, 'not a step-up token')
  }))

Deno.test('step-up token vs access guard: the HMAC check of a user token rejects it', () =>
  withStepUpKeys(async () => {
    const { stepUpToken } = await mintStepUpToken(input)
    const error = await assertRejects(
      () => verifyJWT(stepUpToken, 'step-up-test-jwt-key', { algorithm: 'HS256' }),
      PermissionDenied,
    )
    assertEquals(error.code, 'INVALID_TOKEN_SIGNATURE')
  }))

Deno.test('mintStepUpToken: without the signing key it fails with an InternalError', async () => {
  const saved = Deno.env.get('JWK_PRI')
  Deno.env.delete('JWK_PRI')
  try {
    const error = await assertRejects(() => mintStepUpToken(input), InternalError)
    assertEquals(error.code, 'AUTH_SESSION_JWT_KEY_MISSING')
  } finally {
    if (saved !== undefined) Deno.env.set('JWK_PRI', saved)
  }
})
