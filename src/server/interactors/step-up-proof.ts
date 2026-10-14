import type { Providers } from 'utils/rbac.ts'
import type { FactorChangeOperation } from 'utils/shared-enums.ts'

import { HttpError } from '@zanix/errors'
import logger from '@zanix/logger'
import { generateHash } from '@zanix/helpers'
import { CLAIM_MARGIN_SECONDS, IAM_ERROR_CODES } from 'utils/constants.ts'
import { FACTOR_CHANGE_PURPOSE } from 'utils/shared-enums.ts'
import { contextStepUpToken } from 'utils/step-up-token-guard.ts'
import { verifyStepUpToken } from 'utils/step-up-token.ts'
import { StepUpClaimRepository } from '../repositories/step-up-claim/entity.provider.ts'

/** What a claim guards: a step-up token id, a TOTP code of an account or a step-up one-time code. */
type ClaimKind = 'jti' | 'totp' | 'otp'

/**
 * Claims a value that may be used once, atomically: of any number of concurrent or later calls with
 * the same `kind` and `material`, exactly one answers `true` until `ttlSeconds` (plus a margin) have
 * passed. The value is stored as a digest.
 *
 * @param material What identifies the value, such as the token id or the account and the code.
 * @param ttlSeconds How long the guarded value stays presentable.
 */
export async function claimOnce(
  providers: Providers,
  kind: ClaimKind,
  material: string,
  ttlSeconds: number,
): Promise<boolean> {
  const key = `${kind}:${await generateHash(`${kind}:${material}`, 'low', false)}`
  const expireAt = new Date(Date.now() + (ttlSeconds + CLAIM_MARGIN_SECONDS) * 1000)
  return await providers.get(StepUpClaimRepository).claim(key, expireAt)
}

/** The refusal for a change that came without a proof; `meta` tells the client what to confirm. */
function proofRequired(operation: FactorChangeOperation): HttpError {
  return new HttpError('FORBIDDEN', {
    message: 'This change needs an extra confirmation.',
    code: IAM_ERROR_CODES.factorChangeProofRequired,
    meta: { stepUp: { purpose: FACTOR_CHANGE_PURPOSE, bind: operation } },
    exposeMeta: true,
  })
}

/** The single refusal for every token that does not prove the change. */
function proofInvalid(): HttpError {
  return new HttpError('FORBIDDEN', {
    message: 'The extra confirmation is not valid. Confirm again and retry.',
    code: IAM_ERROR_CODES.factorChangeProofInvalid,
  })
}

/**
 * Checks the `factor-change` step-up token of the request for `operation` on the account
 * `subject`, without consuming it. The token must be signed by this instance, unexpired, issued to
 * `subject` for the `factor-change` purpose and bound to `operation`.
 *
 * Checking and spending are two steps so an operation can validate the rest of its input first
 * (a mistyped code then costs no proof); `spend` must run before the operation writes anything.
 *
 * @returns A handle whose `spend` consumes the token.
 * @throws {HttpError} `FORBIDDEN` with `FACTOR_CHANGE_PROOF_REQUIRED` and the purpose and bind to
 *   confirm in `meta` when the request has no token; `FORBIDDEN` with `FACTOR_CHANGE_PROOF_INVALID`
 *   for any token that does not prove the change.
 */
export async function requireFactorChangeProof(
  providers: Providers,
  context: { locals?: Record<string, unknown> },
  subject: string,
  operation: FactorChangeOperation,
): Promise<{ spend: () => Promise<void> }> {
  const token = contextStepUpToken(context)
  if (!token) throw proofRequired(operation)

  const claims = await verifyStepUpToken(token, {
    subject,
    purpose: FACTOR_CHANGE_PURPOSE,
    bind: operation,
  })
  if (!claims) {
    logger.warn(`A factor-change proof was refused for ${subject} (${operation}).`)
    throw proofInvalid()
  }

  return {
    spend: async () => {
      const ttl = Math.max(claims.exp - Math.floor(Date.now() / 1000), 0)
      if (!await claimOnce(providers, 'jti', claims.jti, ttl)) {
        logger.warn(
          `A spent factor-change proof was presented for ${subject} (${operation}).`,
        )
        throw proofInvalid()
      }
    },
  }
}
