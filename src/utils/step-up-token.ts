import { createAppToken, decodeJWT, JWK_PUB_ENV, verifyJWT } from '@zanix/auth'
import { InternalError } from '@zanix/errors'
import { STEP_UP_TOKEN_TTL_SECONDS } from 'utils/constants.ts'
import { STEP_UP_TOKEN_AUDIENCE, STEP_UP_TOKEN_TYPE } from 'utils/shared-enums.ts'

/** What a step-up token attests: who passed which second factor, for which purpose. */
export type StepUpTokenInput = {
  /** The account id that completed the second factor, taken from the session. */
  subject: string
  /** The action the second factor authorizes. */
  purpose: string
  /** The second factor that was verified. */
  method: 'totp' | 'otp'
  /** An opaque value the token is bound to, such as the identifier of the pending action. */
  bind?: string
}

/** What a step-up token must prove to be accepted by {@linkcode verifyStepUpToken}. */
export type StepUpTokenExpectation = {
  /** The account the token was issued to. */
  subject: string
  /** The action the second factor authorized. */
  purpose: string
  /** The value the token is bound to. */
  bind: string
}

/** The only `kid` a token may name: a rotated version of the signing key, read from
 * `JWK_PUB_V1`, `JWK_PUB_V2`, and so on. Any other `kid` is refused rather than looked up. */
const ROTATED_KEY_ID = /^V\d+$/

/** The public key `token` is verified with: `JWK_PUB`, or the rotated `JWK_PUB_V<n>` its `kid`
 * names, decoded from the base64 the environment holds it in.
 * @throws {Error} For a `kid` that is not a rotated version, or a key that is not set. */
function publicKeyOf(token: string): string {
  const { kid } = decodeJWT(token).header
  if (kid !== undefined && !ROTATED_KEY_ID.test(kid)) throw new Error('unexpected key id')
  const name = kid === undefined ? JWK_PUB_ENV : `${JWK_PUB_ENV}_${kid}`
  const key = Deno.env.get(name)
  if (!key) throw new Error(`${name} is not set`)
  return atob(key)
}

/**
 * Checks a step-up token against this instance's own public key (`JWK_PUB`), the check a service
 * performs on one: RS256 signature, issuer and expiry, then `aud`, `typ`, `purpose`, `sub`, `bind`
 * and the presence of a `jti`.
 *
 * @returns The token's `jti` and `exp` (seconds since the Unix epoch) when it proves
 *   `expected`; `undefined` for anything else, whatever the reason, so a refusal never says which
 *   check failed.
 */
export async function verifyStepUpToken(
  token: string,
  expected: StepUpTokenExpectation,
): Promise<{ jti: string; exp: number } | undefined> {
  let payload
  try {
    payload = await verifyJWT(token, publicKeyOf(token), {
      algorithm: 'RS256',
      aud: STEP_UP_TOKEN_AUDIENCE,
    })
  } catch {
    return undefined
  }
  if (payload.typ !== STEP_UP_TOKEN_TYPE) return undefined
  if (payload.purpose !== expected.purpose) return undefined
  if (payload.sub !== expected.subject) return undefined
  if (payload.bind !== expected.bind) return undefined
  if (typeof payload.jti !== 'string' || payload.jti === '') return undefined
  if (typeof payload.exp !== 'number') return undefined
  return { jti: payload.jti, exp: payload.exp }
}

/**
 * Signs a step-up token with this instance's RSA key (`JWK_PRI`), the key `api` tokens use, so a
 * service verifies it with the public key (`JWK_PUB`) and an HMAC-verified user access token is
 * never confused with it: a user token is checked with `JWT_KEY` and HS256, which an RS256
 * signature cannot satisfy. The `typ` and `aud` claims separate it from every other token this
 * key signs.
 *
 * @returns The token and its `exp` claim, in seconds since the Unix epoch.
 * @throws {InternalError} When `JWK_PRI` is missing (from `createAppToken`) or the signed token
 *   carries no `exp`.
 */
export async function mintStepUpToken(
  input: StepUpTokenInput,
): Promise<{ stepUpToken: string; expiresAt: number }> {
  const { subject, purpose, method, bind } = input
  const stepUpToken = await createAppToken({
    subject,
    type: 'api',
    expiration: STEP_UP_TOKEN_TTL_SECONDS,
    payload: {
      aud: STEP_UP_TOKEN_AUDIENCE,
      typ: STEP_UP_TOKEN_TYPE,
      purpose,
      method,
      ...(bind === undefined ? {} : { bind }),
    },
  })

  const expiresAt = decodeJWT(stepUpToken).payload.exp
  if (typeof expiresAt !== 'number') {
    throw new InternalError('The step-up token was signed without an expiration.', {
      code: 'IAM_STEP_UP_TOKEN_NO_EXPIRATION',
    })
  }
  return { stepUpToken, expiresAt }
}
