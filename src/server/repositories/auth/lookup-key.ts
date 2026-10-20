import { generateHash } from '@zanix/helpers'

/**
 * Computes the deterministic digest an `auth` field stored masked is looked up by: the same value
 * always produces the same digest, so a plaintext can be found again later, which a per-record
 * random salt would break. `'low'` (SHA-1, 1000 stretching iterations) keeps it cheap enough to
 * recompute on every lookup; the digest is no secret of its own, since it sits next to the masked
 * value it was derived from, and the masking is the real protection.
 */
export function computeLookupKeyId(value: string): Promise<string> {
  return generateHash(value, 'low', false)
}
