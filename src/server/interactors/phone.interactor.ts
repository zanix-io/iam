import type { HydratedAuth } from '../repositories/auth/model.defs.ts'
import { Interactor, ZanixInteractor } from '@zanix/server'
import { contextMessageLang } from 'utils/message-lang.ts'
import { HttpError } from '@zanix/errors'
import { ZanixAuthProvider } from '@zanix/auth'
import { NotifierProvider } from '@zanix/notifications'
import { AuthRepository } from '../repositories/auth/entity.provider.ts'
import { isDuplicateKeyError } from '../repositories/duplicate-key.ts'
import {
  IAM_ERROR_CODES,
  type NOTIFIERS,
  phoneEnrollNumberCooldownSeconds,
  phoneUniquePerAccount,
} from 'utils/constants.ts'
import { claimOnce, requireFactorChangeProof } from './step-up-proof.ts'

/** The refusal of a phone number another account already holds. */
function phoneAlreadyInUse(): HttpError {
  return new HttpError('CONFLICT', {
    message: 'This phone number is already verified on another account.',
    code: IAM_ERROR_CODES.phoneAlreadyInUse,
  })
}

/**
 * The verified phone and the passwordless-code channel: enrolment, confirmation, removal and the
 * `otpNotifier` preference.
 */
@Interactor()
export class PhoneService extends ZanixInteractor {
  /**
   * Begins phone verification for the current authenticated session: sends a one-time SMS code to
   * `phone`, WITHOUT persisting anything yet — `phoneConfirm` must verify the caller actually
   * received it before `auth.phone` is ever written (never set anywhere else in this project).
   * Verification is always by SMS regardless of which channel the caller later picks for their own
   * login-OTP preference (`setOtpNotifier`) — this step only proves phone ownership.
   *
   * Keyed under its OWN namespaced `target` (`phone-enroll:<subject>:<phone>`), deliberately never
   * the same target `PasswordService.recovery`/`loginWithOTPCallback` use (the account id/email
   * directly) — a login-OTP request in flight for this same account must never verify against (or
   * invalidate) a phone-enrollment code, or vice versa. The number is part of the target, so the
   * code only verifies for the number it was sent to: `phoneConfirm` with another number finds no
   * code.
   *
   * Each request sends a paid SMS to a number the caller names, so a number that was sent a code
   * less than `PHONE_ENROLL_NUMBER_COOLDOWN_SECONDS` ago is refused, whichever account asks (the
   * route's per-account limit cannot see several accounts aiming at one number).
   *
   * @throws {HttpError} `UNAUTHORIZED` when called with no authenticated session;
   *   `TOO_MANY_REQUESTS` (`PHONE_ENROLL_TOO_SOON`, `meta.retryAfterSeconds`) for a number that was
   *   just sent one.
   */
  public async phoneEnroll(phone: string) {
    const subject = this.context.session?.subject
    if (!subject) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })

    // Claimed before anything is generated or sent: the claim is what keeps a number from being
    // flooded, so a refused request costs no SMS.
    if (
      !await claimOnce(
        this.providers,
        'otp',
        `phone-enroll-to:${phone}`,
        phoneEnrollNumberCooldownSeconds,
      )
    ) {
      throw new HttpError('TOO_MANY_REQUESTS', {
        message: 'A code was sent to this number a moment ago.',
        code: IAM_ERROR_CODES.phoneEnrollTooSoon,
        meta: { retryAfterSeconds: phoneEnrollNumberCooldownSeconds },
        exposeMeta: true,
      })
    }

    const ttl = 300
    const code = await this.providers.get(ZanixAuthProvider).otp.generate({
      target: `phone-enroll:${subject}:${phone}`,
      exp: ttl,
    })

    await this.providers.get(NotifierProvider).sendMessage('sms', {
      to: phone,
      zanixTemplate: 'otp',
      lang: contextMessageLang(this.context),
      data: { code, ttl: ttl / 60 },
    } as never, { useWorker: 'one-time' })

    return { response: 'notification sent' }
  }

  /**
   * Confirms phone verification: verifies `code` against the SAME namespaced target
   * `phoneEnroll` generated it under (which includes `phone`, so a code sent to one number never
   * confirms another) and, only on success, persists `phone` on the current
   * session's account — the first and only place `auth.phone` is ever written in this project.
   * Deliberately does NOT also set `otpNotifier` here — verifying ownership and choosing a login
   * delivery channel are two separate actions (`setOtpNotifier`, below), so confirming a phone
   * never silently changes how an existing login-OTP preference is delivered.
   *
   * Needs a fresh `factor-change` step-up proof for `phone-confirm`, spent only after the code
   * verified. The code is consumed atomically: of two concurrent confirmations with the same code,
   * one succeeds.
   *
   * With `PHONE_UNIQUE_PER_ACCOUNT=true` a number that is already the verified number of another
   * account is refused.
   *
   * @throws {HttpError} `UNAUTHORIZED` with no session; `FORBIDDEN` for a missing, invalid or
   *   spent proof, or if `code` doesn't verify; `CONFLICT` (`PHONE_ALREADY_IN_USE`) for a number
   *   another account holds, when the option is on.
   */
  public async phoneConfirm(phone: string, code: string) {
    const subject = this.context.session?.subject
    if (!subject) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })
    const proof = await requireFactorChangeProof(
      this.providers,
      this.context,
      subject,
      'phone-confirm',
    )

    const target = `phone-enroll:${subject}:${phone}`
    const verified = await this.providers.get(ZanixAuthProvider).otp.verify(target, code)
    // The library's check-then-burn lets two concurrent verifications of one code both pass; the
    // claim lets exactly one through.
    if (!verified || !await claimOnce(this.providers, 'otp', `${target}:${code}`, 300)) {
      throw new HttpError('FORBIDDEN', { message: 'Invalid or expired code.' })
    }
    await proof.spend()

    const authRepository = this.providers.get(AuthRepository)
    // Checked only now, after the caller proved it receives SMS at this number, so the refusal
    // never tells anyone whether a number they do not control is registered.
    if (phoneUniquePerAccount()) {
      const holder = await authRepository.findIdByPhone(phone)
      if (holder && holder !== subject) throw phoneAlreadyInUse()
    }
    try {
      await authRepository.setPhone(subject, phone)
    } catch (error) {
      // Another account confirmed the same number between the check and the write.
      if (phoneUniquePerAccount() && isDuplicateKeyError(error)) throw phoneAlreadyInUse()
      throw error
    }

    return { response: 'Phone verified' }
  }

  /**
   * Forgets the caller's own verified phone entirely — the counterpart to `phoneConfirm`. Always
   * clears `otpNotifier` alongside `phone`: a login-OTP preference of `'sms'`/`'whatsapp'` with no
   * phone behind it is a broken, unreachable configuration `PasswordService.recovery` would have
   * to plug around at dispatch time, so this method makes that state unreachable instead of
   * defending against it downstream. To use SMS/WhatsApp again later, the number must be
   * re-verified from scratch via `phoneEnroll`/`phoneConfirm`.
   *
   * Needs a fresh `factor-change` step-up proof for `phone-disable`.
   *
   * @throws {HttpError} `UNAUTHORIZED` with no session; `FORBIDDEN` for a missing, invalid or
   *   spent proof, or when the session subject no longer resolves to a real `auth` record.
   */
  public async disablePhone() {
    const authId = this.context.session?.subject
    if (!authId) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })
    const proof = await requireFactorChangeProof(
      this.providers,
      this.context,
      authId,
      'phone-disable',
    )

    const auth = await this.providers.get(AuthRepository).findById(authId) as
      | HydratedAuth
      | undefined
    if (!auth) throw new HttpError('FORBIDDEN', { message: 'Account not found.' })
    await proof.spend()

    await this.providers.get(AuthRepository).updateAuth(
      { id: authId },
      { unset: ['phone', 'phoneKeyId', 'otpNotifier'] },
    )
    return { response: 'Phone removed' }
  }

  /**
   * Sets (or clears) which channel the caller's OWN passwordless login-OTP code
   * (`PasswordService.recovery`, `isLogin: true`) is delivered through — `undefined`/omitted
   * `notifier` resets to the default, `'email'` (see `AuthenticationAttrs.otpNotifier`'s own doc
   * for why that's never stored explicitly). This is NEVER itself a verification step — choosing
   * `'sms'`/`'whatsapp'` here only ever succeeds once `phoneConfirm` already proved the caller
   * controls a real phone; switching between `'sms'`/`'whatsapp'`/`'email'` afterward, any number
   * of times, needs no further verification as long as `auth.phone` stays set.
   *
   * `notifier: ''` is treated identically to `undefined` — see `OtpNotifierRTO`'s own doc
   * (`handlers/rtos/password.ts`) for why a real caller (a plain HTML `<select>`'s "Email" option)
   * submits an empty string rather than omitting the field entirely.
   *
   * Needs a fresh `factor-change` step-up proof for `otp-notifier`: the channel decides where the
   * factor's codes go, so changing it changes the factor.
   *
   * @throws {HttpError} `UNAUTHORIZED` with no session; `FORBIDDEN` for a missing, invalid or
   *   spent proof, or when the session subject no longer resolves to a real `auth` record;
   *   `BAD_REQUEST` when `notifier` is `'sms'`/`'whatsapp'` and the account has no verified
   *   `phone` on file yet.
   */
  public async setOtpNotifier(notifier?: Exclude<typeof NOTIFIERS[number], 'email'> | '') {
    const authId = this.context.session?.subject
    if (!authId) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })
    const proof = await requireFactorChangeProof(
      this.providers,
      this.context,
      authId,
      'otp-notifier',
    )

    const auth = await this.providers.get(AuthRepository).findById(authId) as
      | HydratedAuth
      | undefined
    if (!auth) throw new HttpError('FORBIDDEN', { message: 'Account not found.' })

    if (notifier && !auth.phone) {
      throw new HttpError('BAD_REQUEST', {
        message: 'Verify a phone number before choosing SMS/WhatsApp for your login code.',
      })
    }
    await proof.spend()

    if (notifier) {
      await this.providers.get(AuthRepository).updateAuth({ id: authId, otpNotifier: notifier })
    } else {
      await this.providers.get(AuthRepository).updateAuth({ id: authId }, {
        unset: ['otpNotifier'],
      })
    }
    return { response: 'OTP delivery preference updated' }
  }
}
