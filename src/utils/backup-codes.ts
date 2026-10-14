import { generateHash } from '@zanix/helpers'
import { BACKUP_CODE_COUNT } from './constants.ts'

/**
 * The characters of a backup code: 32 letters and digits with the look-alikes left out (no `0`,
 * `1`, `I`, `O`), so a code read from paper is typed without guessing. 32 divides 256, so a random
 * byte masked to five bits picks a character with no bias.
 */
export const BACKUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Characters of a code, without the dash: 10 characters of 5 bits each are 50 bits. */
export const BACKUP_CODE_LENGTH = 10

const BACKUP_CODE_SHAPE = new RegExp(`^[${BACKUP_CODE_ALPHABET}]{${BACKUP_CODE_LENGTH}}$`)

/** Formats the 10 characters of a code as `XXXXX-XXXXX`, the way it is shown and printed. */
function format(chars: string): string {
  return `${chars.slice(0, 5)}-${chars.slice(5)}`
}

/**
 * One new backup code, drawn from the platform CSPRNG (`crypto.getRandomValues`), as `XXXXX-XXXXX`.
 */
export function generateBackupCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(BACKUP_CODE_LENGTH))
  return format(Array.from(bytes, (byte) => BACKUP_CODE_ALPHABET[byte & 31]).join(''))
}

/** A set of `count` backup codes (default {@linkcode BACKUP_CODE_COUNT}), each different. */
export function generateBackupCodes(count: number = BACKUP_CODE_COUNT): string[] {
  const codes = new Set<string>()
  while (codes.size < count) codes.add(generateBackupCode())
  return [...codes]
}

/**
 * Reads what a person typed as a backup code: case-insensitive, with spaces and dashes ignored.
 * Answers the 10 canonical characters, or `undefined` when the input does not have the shape of a
 * backup code (a 6-digit authenticator code never does, so the shape decides which factor a code
 * is checked as).
 */
export function normalizeBackupCode(input: string): string | undefined {
  const chars = input.replace(/[\s-]/g, '').toUpperCase()
  return BACKUP_CODE_SHAPE.test(chars) ? chars : undefined
}

/**
 * The digest a backup code is stored and looked up by: `@zanix/helpers`' `generateHash`, the
 * primitive behind every hash of this ecosystem (`password`'s `protection: 'hash'` is the same
 * function), at the `medium` level (SHA-256, 5000 rounds), salted with the account id.
 *
 * The salt is the account id, not a random one: the digest must be reproducible from the typed code
 * so the database can match it with an equality filter, which is what lets a use be a single atomic
 * write (`AuthRepository.consumeBackupCode`). The account id still keeps two accounts' identical
 * codes, and any precomputed table, from sharing a digest. A code carries 50 random bits, so the
 * stretched digest is not brute-forced from a leaked database.
 *
 * @param authId The account the code belongs to.
 * @param normalized A code as {@linkcode normalizeBackupCode} answers it.
 */
export function hashBackupCode(authId: string, normalized: string): Promise<string> {
  return generateHash(normalized, 'medium', new TextEncoder().encode(authId))
}

/** The digests of `codes` (as {@linkcode generateBackupCodes} answers them) for the account. */
export function hashBackupCodes(authId: string, codes: readonly string[]): Promise<string[]> {
  return Promise.all(codes.map((code) => hashBackupCode(authId, normalizeBackupCode(code) ?? code)))
}
