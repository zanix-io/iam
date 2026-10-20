import { computeLookupKeyId } from './lookup-key.ts'

/**
 * Computes the deterministic digest of a normalized (E.164) `phone` that `auth.phoneKeyId` holds:
 * `phone` is stored masked, so uniqueness and lookups go through this digest, as `email` goes
 * through {@linkcode computeEmailKeyId}. The `phone:` prefix keeps it from ever equalling an
 * email digest.
 */
export function computePhoneKeyId(phone: string): Promise<string> {
  return computeLookupKeyId(`phone:${phone}`)
}
