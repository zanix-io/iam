import type { HydratedAuth } from '../repositories/auth/model.defs.ts'

import { Interactor, ZanixInteractor } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import { ZanixAuthProvider } from '@zanix/auth'
import { NotifierProvider } from '@zanix/notifications'
import { resolveConfig } from '@zanix/app/runtime'
import { contextMessageLang } from 'utils/message-lang.ts'
import { buildStepUpMessage } from 'utils/step-up-message.ts'
import { mintStepUpToken } from 'utils/step-up-token.ts'
import { NOTIFIERS, STEP_UP_CODE_TTL_SECONDS } from 'utils/constants.ts'
import { AuthRepository } from '../repositories/auth/entity.provider.ts'
import { UsersRepository } from '../repositories/users/entity.provider.ts'
import { recordEmailProof } from './email-proof.ts'
import { claimOnce } from './step-up-proof.ts'

/** What `StepUpService.request` answers: which factor the user must complete. */
export type StepUpRequestResult = {
  /** `'totp'`: enter the authenticator-app code, nothing was sent. `'otp'`: a code was sent. */
  method: 'totp' | 'otp'
  /** The channel a one-time code was sent through; present only for `method: 'otp'`. */
  channel?: typeof NOTIFIERS[number]
  /** Seconds the caller has to complete `verify`. */
  expiresInSeconds: number
}

/** What `StepUpService.verify` answers on success. */
export type StepUpVerifyResult = {
  /** The signed step-up token. */
  stepUpToken: string
  /** The token's `exp` claim, in seconds since the Unix epoch. */
  expiresAt: number
}

/**
 * The cache target of a step-up one-time code. The `step-up:` prefix keeps it apart from every
 * other code in the same store (a login code is keyed by the bare account id or email, a phone
 * enrollment code by `phone-enroll:<id>`), and `purpose` (which never contains `:`) keeps one
 * purpose's code from verifying another's. The email code has no channel suffix; the other
 * channels append theirs, so the channel that delivered a verified code is known.
 */
export function stepUpOtpTarget(
  purpose: string,
  subject: string,
  channel: typeof NOTIFIERS[number] = 'email',
): string {
  const target = `step-up:${purpose}:${subject}`
  return channel === 'email' ? target : `${target}:${channel}`
}

/**
 * Second-factor re-verification of an already authenticated user ("step-up"), ahead of a sensitive
 * action. The factor follows the account's own settings and the caller cannot pick a different
 * one: TOTP when the account has it enabled, otherwise a one-time code sent through its configured
 * notifier. A successful `verify` returns a short-lived token (`utils/step-up-token.ts`) that a
 * service checks before it performs the action.
 *
 * The account is always the session's own subject, never anything in the request body.
 */
@Interactor()
export class StepUpService extends ZanixInteractor {
  /**
   * Starts a step-up for `purpose`. A TOTP account is only told to enter its authenticator code;
   * any other account gets a one-time code through its `otpNotifier` (email by default), generated
   * and stored by the same OTP machinery as the login code but under a target scoped to `purpose`.
   * The message is the channel's built-in `generic` template filled by {@linkcode buildStepUpMessage}:
   * `purpose` only selects the wording (`step-up.purpose.<purpose>`), it is never part of the text.
   *
   * @throws {HttpError} `UNAUTHORIZED` with no session; `FORBIDDEN` when the account no longer
   *   exists or cannot sign in; `BAD_REQUEST` when the configured channel has no destination.
   */
  public async request(purpose: string): Promise<StepUpRequestResult> {
    const auth = await this.requireActiveAccount()
    const expiresInSeconds = STEP_UP_CODE_TTL_SECONDS

    if (this.methodOf(auth) === 'totp') return { method: 'totp', expiresInSeconds }

    const channel = auth.otpNotifier ?? NOTIFIERS[0]
    const to = channel === 'email' ? auth.email.unmask() : auth.phone?.unmask()
    if (!to) {
      throw new HttpError('BAD_REQUEST', {
        message: `No ${channel} destination on file for this account.`,
      })
    }

    const code = await this.providers.get(ZanixAuthProvider).otp.generate({
      target: stepUpOtpTarget(purpose, auth.id, channel),
      exp: expiresInSeconds,
    })
    const lang = contextMessageLang(this.context)
    const message = buildStepUpMessage(channel, lang, purpose, code, expiresInSeconds / 60)
    await this.providers.get(NotifierProvider).sendMessage(channel, {
      to,
      lang,
      ...message,
    } as never, { useWorker: 'one-time' })

    return { method: 'otp', channel, expiresInSeconds }
  }

  /**
   * Verifies `code` with the account's own factor and, on success, signs a step-up token for
   * `purpose` (and `bind`, when given). A one-time code is consumed by the check, atomically: of two
   * concurrent verifications of the same code exactly one succeeds. An authenticator code is
   * accepted once per account within its window. Both factors are checked against the account's
   * settings at this moment, not against whatever `request` answered.
   *
   * @throws {HttpError} `UNAUTHORIZED` with no session. `FORBIDDEN`, with one message for every
   *   failure, when the account is gone or cannot sign in, the code is wrong, expired or was never
   *   issued, or the code was issued for another purpose.
   */
  public async verify(purpose: string, code: string, bind?: string): Promise<StepUpVerifyResult> {
    const subject = this.requireSubject()
    const auth = await this.findAccount(subject)
    if (!auth || !(await this.isActive(auth))) throw this.denied()

    const method = this.methodOf(auth)
    let verified = false
    if (method === 'totp') {
      verified = await this.verifyTotp(auth, code)
    } else {
      const channel = await this.verifyOtp(purpose, auth.id, code)
      verified = channel !== undefined
      // An email code proves the mailbox.
      if (channel === 'email') await recordEmailProof(this.providers, auth.id)
    }
    if (!verified) throw this.denied()

    return mintStepUpToken({ subject: auth.id, purpose, method, bind })
  }

  /** The factor the account's settings require: TOTP when enabled, a one-time code otherwise. */
  private methodOf(auth: HydratedAuth): 'totp' | 'otp' {
    return auth.twoFactorAuthConfig?.method === 'totp' ? 'totp' : 'otp'
  }

  /**
   * Checks a one-time `code` against each channel's pending code (a channel without one counts no
   * failed attempt) and answers the channel whose code matched, `undefined` when none did. The
   * library's check-then-burn lets two concurrent checks of one code both pass, so a match is also
   * claimed in the claim store, which lets exactly one through.
   */
  private async verifyOtp(
    purpose: string,
    subject: string,
    code: string,
  ): Promise<typeof NOTIFIERS[number] | undefined> {
    const otp = this.providers.get(ZanixAuthProvider).otp
    for (const channel of NOTIFIERS) {
      // Sequential on purpose: the email code is tried first and a match ends the search.
      const target = stepUpOtpTarget(purpose, subject, channel)
      // deno-lint-ignore no-await-in-loop
      if (!await otp.verify(target, code)) continue
      // deno-lint-ignore no-await-in-loop
      const claimed = await claimOnce(
        this.providers,
        'otp',
        `${target}:${code}`,
        STEP_UP_CODE_TTL_SECONDS,
      )
      return claimed ? channel : undefined
    }
    return undefined
  }

  /**
   * Checks an authenticator code against the account's enrolled secret; `false` without one. A
   * matching code is claimed, so it verifies once per account within the span of steps the
   * verification tolerates.
   */
  private async verifyTotp(auth: HydratedAuth, code: string): Promise<boolean> {
    const secret = await auth.totpSecret?.decrypt()
    if (!secret) return false
    const window = resolveConfig<number>('auth', 'totpToleranceSteps') ?? 1
    const verified = await this.providers.get(ZanixAuthProvider).totp.verify(secret, code, {
      window,
    })
    return verified &&
      await claimOnce(this.providers, 'totp', `${auth.id}:${code}`, (2 * window + 1) * 30)
  }

  /** The session subject (the account id). @throws {HttpError} `UNAUTHORIZED` without one. */
  private requireSubject(): string {
    const subject = this.context.session?.subject
    if (!subject) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })
    return subject
  }

  private async findAccount(subject: string): Promise<HydratedAuth | undefined> {
    return await this.providers.get(AuthRepository).findById(subject) as HydratedAuth | undefined
  }

  /** Whether the account's linked profile may still sign in. */
  private async isActive(auth: HydratedAuth): Promise<boolean> {
    try {
      await this.providers.get(UsersRepository).assertActive(auth.userId)
      return true
    } catch (error) {
      if (error instanceof HttpError) return false
      throw error
    }
  }

  /** The session's account, if it exists and may sign in. @throws {HttpError} otherwise. */
  private async requireActiveAccount(): Promise<HydratedAuth> {
    const auth = await this.findAccount(this.requireSubject())
    if (!auth) throw new HttpError('FORBIDDEN', { message: 'Account not found.' })
    await this.providers.get(UsersRepository).assertActive(auth.userId)
    return auth
  }

  /** The single failure `verify` answers, whatever went wrong. */
  private denied(): HttpError {
    return new HttpError('FORBIDDEN', { message: 'Invalid or expired code.' })
  }
}
