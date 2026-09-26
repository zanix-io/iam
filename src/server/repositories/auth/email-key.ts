import { generateHash } from '@zanix/helpers'

/**
 * Computes a deterministic digest of `email` — the real lookup key `AuthRepository.findByEmail`
 * (and `registerAuth`) use, since `email` itself is stored masked (see `model.defs.ts`'s own
 * doc for why: a masked value isn't directly equality-queryable without a separate deterministic
 * index alongside it).
 *
 * Reuses `@zanix/helpers`' own `generateHash` — the SAME primitive this ecosystem already uses
 * for every other one-way digest (`password`'s own `dataPoliciesGetter({ protection: 'hash' })`,
 * which `@zanix/datamaster` backs with this identical function) — rather than a hand-rolled
 * `crypto.subtle` call, deliberately called with `useSalt: false`: unlike a password hash, this
 * value MUST be deterministic (the same email always produces the same digest) so a plaintext
 * `email` can be looked up again later, which a per-record random salt would break entirely.
 * `'low'` (SHA-1, 1000 stretching iterations) is used instead of `generateHash`'s own `'medium'`
 * default deliberately — this digest is recomputed on every login/lookup attempt, not just once
 * at password-set time, so it needs to stay cheap; it isn't standing in for password-grade
 * brute-force resistance of its own; an attacker with database access already sees this digest
 * sitting right next to the masked `email` it was derived from, so treating it as a secret in its
 * own right would be misleading, not protective — the real protection is `email` staying masked.
 *
 * No case-folding/trimming applied here beyond what `@IsEmail` validation already normalizes
 * upstream — lookups stay exactly as case-sensitive as a plain, unmasked `email` field would be.
 */
export function computeEmailKeyId(email: string): Promise<string> {
  return generateHash(email, 'low', false)
}
