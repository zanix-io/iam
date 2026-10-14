import type { AuthSessionOptions, SessionTokens } from '@zanix/auth'
import type { Providers } from 'utils/rbac.ts'

import logger from '@zanix/logger'
import { HttpError } from '@zanix/errors'
import { ZanixAuthProvider } from '@zanix/auth'
import { NOTIFIERS } from 'utils/constants.ts'
import { AuthRepository } from '../repositories/auth/entity.provider.ts'

/** One delivery channel of a sign-in code. */
type Notifier = typeof NOTIFIERS[number]

/** The standard OpenID Connect claim an access token carries for "this account has proven it
 * controls its email mailbox". */
export const EMAIL_VERIFIED_CLAIM = 'email_verified'

/**
 * The session options that put the `email_verified` claim on an access token, for
 * `session.generateTokens`, `otp.authenticate`, `totp.authenticate` and the `sessionOptions` of
 * `session.refreshTokens`.
 */
export function emailVerifiedPayload(
  emailVerified: boolean,
): { payload: { [EMAIL_VERIFIED_CLAIM]: boolean } } {
  return { payload: { [EMAIL_VERIFIED_CLAIM]: emailVerified } }
}

/**
 * The cache target of the sign-in code delivered to an account through `channel`. The email code
 * keeps the bare account id; the others carry the channel, so which channel delivered a verified
 * code is known from the target that matched.
 */
export function otpLoginTarget(authId: string, channel: Notifier): string {
  return channel === 'email' ? authId : `${authId}:${channel}`
}

/**
 * Verifies a sign-in code for `auth` and mints the session through `ZanixAuthProvider.otp`,
 * trying the code of each delivery channel in turn (a target without a pending code counts no
 * failed attempt). The `email_verified` claim is `true` when the email code matched, since that
 * code proves the mailbox, and the account's stored state when another channel matched.
 *
 * @returns The session tokens and the channel whose code matched.
 * @throws {HttpError} The first channel's `FORBIDDEN` (`INVALID_OTP`) when no code matched; any
 *   other error is rethrown as it is.
 */
export async function authenticateAccountOtp(
  providers: Providers,
  auth: { id: string; emailVerifiedAt?: Date | null },
  code: string,
  options: AuthSessionOptions,
): Promise<{ tokens: SessionTokens; channel: Notifier }> {
  const otp = providers.get(ZanixAuthProvider).otp
  let invalidCode: unknown
  for (const channel of NOTIFIERS) {
    const emailVerified = channel === 'email' ? true : Boolean(auth.emailVerifiedAt)
    try {
      // Sequential on purpose: the email code is tried first and a match ends the search.
      // deno-lint-ignore no-await-in-loop
      const tokens = await otp.authenticate(otpLoginTarget(auth.id, channel), code, {
        ...options,
        ...emailVerifiedPayload(emailVerified),
      })
      return { tokens, channel }
    } catch (error) {
      if (!(error instanceof HttpError) || error.code !== 'INVALID_OTP') throw error
      invalidCode ??= error
    }
  }
  throw invalidCode
}

/**
 * Records that `authId` proved control of its mailbox. The sign-in that triggered it has already
 * succeeded, so a failed write is logged and swallowed: the next proof records it.
 */
export async function recordEmailProof(providers: Providers, authId: string): Promise<void> {
  try {
    await providers.get(AuthRepository).markEmailVerified(authId)
  } catch (error) {
    logger.warn(
      `The email verification of account ${authId} could not be recorded: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    )
  }
}
