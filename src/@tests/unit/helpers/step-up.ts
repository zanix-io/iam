import { JWK_PRI_ENV, JWK_PUB_ENV, verifyJWT } from '@zanix/auth'
import type { JWTPayload } from '@zanix/auth'
import { generateRSAKeys } from '@zanix/helpers'
import { STEP_UP_TOKEN_AUDIENCE, STEP_UP_TOKEN_TYPE } from 'utils/shared-enums.ts'

/** One RSA key pair for a whole test file: generating it is the slow part of a step-up test. */
export const stepUpTestKeys = await generateRSAKeys()
const keys = stepUpTestKeys

/** Runs `run` with `JWK_PRI`/`JWK_PUB` set to the test key pair (as `iam` and a verifying service
 * would hold them), restoring the previous values afterwards. */
export async function withStepUpKeys<T>(run: () => Promise<T> | T): Promise<T> {
  const saved = [JWK_PRI_ENV, JWK_PUB_ENV].map((name) => [name, Deno.env.get(name)] as const)
  Deno.env.set(JWK_PRI_ENV, btoa(keys.privateKey))
  Deno.env.set(JWK_PUB_ENV, btoa(keys.publicKey))
  try {
    return await run()
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) Deno.env.delete(name)
      else Deno.env.set(name, value)
    }
  }
}

/**
 * The check a service performs on a step-up token, written out as the documentation describes it:
 * RS256 signature against `iam`'s public key, issuer and expiry, then the audience, `typ`, the
 * purpose and subject it expects, and the bind value when it expects one.
 *
 * @throws When any check fails.
 */
export async function verifyStepUpToken(
  token: string,
  expected: { purpose: string; subject: string; bind?: string },
): Promise<JWTPayload> {
  const payload = await verifyJWT(token, atob(btoa(keys.publicKey)), {
    algorithm: 'RS256',
    aud: STEP_UP_TOKEN_AUDIENCE,
  })
  if (payload.typ !== STEP_UP_TOKEN_TYPE) throw new Error('not a step-up token')
  if (payload.purpose !== expected.purpose) throw new Error('wrong purpose')
  if (payload.sub !== expected.subject) throw new Error('wrong subject')
  if (expected.bind !== undefined && payload.bind !== expected.bind) throw new Error('wrong bind')
  return payload
}
