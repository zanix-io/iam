import type { HydratedAuth } from '../repositories/auth/model.defs.ts'
import type { Providers } from 'utils/rbac.ts'
import type { sendAccountNotice } from './account-notice.ts'

import logger from '@zanix/logger'
import {
  generateBackupCodes,
  hashBackupCode,
  hashBackupCodes,
  normalizeBackupCode,
} from 'utils/backup-codes.ts'
import { AuthRepository } from '../repositories/auth/entity.provider.ts'

/**
 * A new set of backup codes for `authId`: the plaintext codes, for the one response that shows
 * them, and the digests and issue time to store. Nothing is written here.
 */
export async function createBackupCodeSet(authId: string, at: Date = new Date()) {
  const codes = generateBackupCodes()
  return {
    codes,
    fields: { backupCodeHashes: await hashBackupCodes(authId, codes), backupCodesGeneratedAt: at },
  }
}

/**
 * Issues a new set of backup codes for the account, replacing every code it held, and answers the
 * plaintext codes (the only time they exist outside the person's hands).
 */
export async function replaceBackupCodes(providers: Providers, authId: string): Promise<string[]> {
  const { codes, fields } = await createBackupCodeSet(authId)
  await providers.get(AuthRepository).replaceBackupCodes(
    authId,
    fields.backupCodeHashes,
    fields.backupCodesGeneratedAt,
  )
  return codes
}

/**
 * Spends `input` as a backup code of `auth`. Answers `false`, touching nothing, for an input that
 * does not have the shape of a backup code and for a code the account does not hold or already
 * spent; the caller turns that into the same refusal a wrong authenticator code gets. The spend is
 * one atomic write (`AuthRepository.consumeBackupCode`): of two concurrent uses of one code,
 * exactly one answers `true`.
 *
 * On success the owner is emailed that a backup code was used, with how many remain; a failure to
 * send that notice is logged and does not undo the spend (the code is already gone).
 *
 * @param notice Sends the `totp-backup-code-used` notice ({@linkcode sendAccountNotice} bound to
 *   the request's context).
 */
export async function spendBackupCode(
  providers: Providers,
  auth: Pick<HydratedAuth, 'id' | 'email'>,
  input: string,
  notice: (to: string | undefined, remaining: number) => ReturnType<typeof sendAccountNotice>,
): Promise<boolean> {
  const normalized = normalizeBackupCode(input)
  if (!normalized) return false
  const remaining = await providers.get(AuthRepository).consumeBackupCode(
    auth.id,
    await hashBackupCode(auth.id, normalized),
  )
  if (remaining === undefined) return false
  try {
    await notice(auth.email?.unmask(), remaining)
  } catch (error) {
    logger.warn(
      `The backup-code notice of ${auth.id} could not be sent: ${(error as Error)?.message}`,
    )
  }
  return true
}
