import type { HydratedAuth } from '../repositories/auth/model.defs.ts'
import type { AuthSessionOptions } from '@zanix/auth'

import { Interactor, ZanixInteractor } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import { ZanixAuthProvider } from '@zanix/auth'
import { NotifierProvider } from '@zanix/notifications'
import { resolveBehavior, resolveConfig } from '@zanix/app/runtime'
import { AuthRepository } from '../repositories/auth/entity.provider.ts'
import { UsersRepository } from '../repositories/users/entity.provider.ts'
import {
  blocksSignIn,
  NOTIFIERS,
  resolveConfiguredAccessExpiration,
  resolveConfiguredRefreshExpiration,
  TOKEN_EXPIRATION,
} from 'utils/constants.ts'
import { permissionsForAccount } from './session-permissions.ts'

/** The generic confirmation `PasswordService.recovery` answers with after a dispatch, and for a
 * password-recovery request it declines to send, so the two are indistinguishable. */
const RECOVERY_RESPONSE = 'notification sent'

/**
 * Password change/recovery flows — split from `AuthService` (login/session/2FA-enrollment); the
 * OTP-generation mechanism is genuinely shared (`recovery`/`recoveryCallback` back both password
 * recovery AND `AuthService.loginWithOTP`'s own OTP-login flow, AND `UsersService.registerUser`'s
 * own no-password invite path).
 *
 * `recoveryCallback`/`changePwd`/`addPassword` gate on `UsersRepository.assertActive` the same way
 * `AuthService`'s login paths do (see that file's header doc); `recovery` reads the profile status
 * itself — see its doc.
 */
@Interactor()
export class PasswordService extends ZanixInteractor {
  /**
   * Changes the current session's own password after verifying `currentPassword`, applying
   * `passwordPolicy` (`auth.app.ts`'s own overridable `behaviors` slot) to the new one, and
   * clears the `mustChangePassword` flag.
   *
   * @throws {HttpError} `UNAUTHORIZED` with no session; `FORBIDDEN` when `currentPassword`
   *   doesn't match; `BAD_REQUEST` when `newPassword` fails the active password policy.
   */
  public async changePwd(currentPassword: string, newPassword: string) {
    const id = this.context.session?.subject
    if (!id) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })

    const auth = await this.providers.get(AuthRepository).findById(id) as HydratedAuth | undefined
    const canChange = await auth?.password?.verify(currentPassword)
    if (!auth || !canChange) {
      throw new HttpError('FORBIDDEN', { message: 'Invalid password or session.' })
    }
    await this.providers.get(UsersRepository).assertActive(auth.userId)

    this.assertPasswordPolicy(newPassword)

    await this.providers.get(AuthRepository).updateAuth(
      { id, password: newPassword },
      { applyProtection: true, unset: ['mustChangePassword'] },
    )

    await this.providers.get(NotifierProvider).email({
      to: auth.email.unmask(),
      subject: 'Your password was changed',
      zanixTemplate: 'password-changed',
      data: {},
    }, { useWorker: 'one-time' })

    return { response: 'password changed' }
  }

  /**
   * Sets a password for the caller's own account, ONLY when it doesn't already have one (add, never
   * change) — meant for an already-authenticated sign-in-methods settings screen, never signup.
   * Deliberately never asks for a
   * current password, unlike {@link changePwd}: there genuinely isn't one to prove knowledge of
   * yet. An account that already has a password must go through `changePwd` instead — this method
   * refuses outright rather than silently overwriting one.
   *
   * @throws {HttpError} `UNAUTHORIZED` with no session; `FORBIDDEN` when the session subject no
   *   longer resolves to a real `auth` record; `CONFLICT` when a password is already set;
   *   `BAD_REQUEST` when `newPassword` fails the active password policy.
   */
  public async addPassword(newPassword: string) {
    const id = this.context.session?.subject
    if (!id) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })

    const auth = await this.providers.get(AuthRepository).findById(id) as HydratedAuth | undefined
    if (!auth) throw new HttpError('FORBIDDEN', { message: 'Account not found.' })
    if (auth.password) {
      throw new HttpError('CONFLICT', {
        message: 'A password is already set for this account. Use change-password instead.',
      })
    }
    await this.providers.get(UsersRepository).assertActive(auth.userId)

    this.assertPasswordPolicy(newPassword)

    await this.providers.get(AuthRepository).updateAuth(
      { id, password: newPassword },
      { applyProtection: true },
    )

    await this.providers.get(NotifierProvider).email({
      to: auth.email.unmask(),
      subject: 'A password was added to your account',
      zanixTemplate: 'password-changed',
      data: {},
    }, { useWorker: 'one-time' })

    return { response: 'password added' }
  }

  /**
   * Removes the caller's own password entirely. No "last remaining method" guard, same reasoning as `AuthService.unlinkOauth`'s own doc:
   * email+OTP always works regardless of `password`/`oauthProvider`, so there's no real lockout
   * scenario this could cause.
   *
   * @throws {HttpError} `UNAUTHORIZED` with no session; `FORBIDDEN` when the session subject no
   *   longer resolves to a real `auth` record.
   */
  public async removePassword() {
    const id = this.context.session?.subject
    if (!id) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })

    const auth = await this.providers.get(AuthRepository).findById(id) as HydratedAuth | undefined
    if (!auth) throw new HttpError('FORBIDDEN', { message: 'Account not found.' })

    if (auth.password) {
      await this.providers.get(AuthRepository).updateAuth(
        { id },
        { unset: ['password', 'mustChangePassword'] },
      )
    }
    return { response: 'password removed' }
  }

  /**
   * Generates an OTP (5-minute TTL) for `email`'s account and dispatches it through `notifier`
   * via `@zanix/notifications`' `NotifierProvider` — email uses this package's built-in
   * `login-otp`/`password-recovery` templates, SMS/WhatsApp use its built-in `otp` template
   * (shared across both). Shared by both the OTP-login flow
   * (`AuthService.loginWithOTP`) and a direct password-recovery request — only the delivered
   * template differs (`isLogin`), the underlying OTP generation is identical.
   *
   * `isLogin: true` with no existing `auth` record for `email`, `notifier` resolving to `'email'`,
   * and `selfRegistrationViaOTP` allowed (`auth.app.ts`'s own doc — same shape/reasoning as
   * `selfRegistrationViaOAuth`) generates the code against `target: email` instead of an `auth`
   * id, so a first-time OTP-login request from an unrecognized email is this project's real
   * passwordless-signup entry point rather than a dead end. **No `auth`/`users` record is created
   * here** — this only reserves a code the recipient can later prove receipt of;
   * `AuthService.loginWithOTPCallback` is what actually provisions the account, and only once that
   * code verifies (see its own doc for why account creation waits for a verified identity rather
   * than happening at dispatch time).
   *
   * A password-recovery request (`isLogin` unset) answers the same generic confirmation for every
   * email, and sends nothing when the account is unknown, deactivated or deleted, so the response
   * never reveals whether an account exists. An OTP-login request (`isLogin: true`) still rejects
   * an unknown email that self-registration refuses; a deactivated account gets its code, since
   * `AuthService.loginWithOTPCallback` answers a verified code with a reactivation challenge.
   *
   * `options.notifier` omitted (the plain OTP-login request `AuthService.loginWithOTP` makes with
   * no `is2FA`) resolves to the account's own `otpNotifier` preference
   * (`AuthService.setOtpNotifier`) when one is set, `'email'` otherwise — a real 2FA challenge
   * (`AuthService.finishLogin`) always passes an explicit `notifier` instead, which wins
   * unconditionally. Either way this dispatches through exactly ONE channel, never both.
   *
   * @throws {HttpError} With `isLogin` only: `FORBIDDEN` when no account exists for `email` and
   *   this isn't an eligible self-registration dispatch, or when the account is deleted.
   *   `BAD_REQUEST` when the resolved notifier is `'sms'`/`'whatsapp'` and the account has no
   *   `phone` on file.
   * @returns A generic dispatch confirmation, never the OTP code itself.
   */
  public async recovery(
    email: string,
    options: { isLogin?: boolean; notifier?: typeof NOTIFIERS[number] } = {},
  ): Promise<{ response: string }> {
    const { isLogin } = options

    const auth = await this.providers.get(AuthRepository).findByEmail(
      email,
    ) as unknown as HydratedAuth
    const notifier = options.notifier ?? auth?.otpNotifier ?? NOTIFIERS[0]

    const selfRegistrationDispatch = !auth && isLogin && notifier === 'email' &&
      (resolveConfig<boolean>('auth', 'selfRegistrationViaOTP') ?? true)
    const profile = auth
      ? await this.providers.get(UsersRepository).findById(auth.userId)
      : undefined

    if (!isLogin) {
      // Password recovery answers identically whether or not a usable account exists, so the
      // response never reveals which emails are registered: nothing is sent for an unknown,
      // deactivated or deleted account.
      if (!auth || blocksSignIn(profile?.status)) {
        return { response: RECOVERY_RESPONSE }
      }
    } else {
      if (!auth && !selfRegistrationDispatch) {
        throw new HttpError('FORBIDDEN', { message: 'No account for this email.' })
      }
      // An `'INACTIVE'` account still gets its login code: `AuthService.loginWithOTPCallback`
      // answers a verified code with a reactivation challenge. `'DELETED'` never signs in again.
      if (profile?.status === 'DELETED') {
        throw new HttpError('FORBIDDEN', { message: 'This account no longer exists.' })
      }
    }

    const ttl = 300
    const code = await this.providers.get(ZanixAuthProvider).otp.generate({
      // Unrecognized-but-eligible email: the OTP cache has no `auth.id` to key against yet, so
      // the plain email itself is the target — `AuthService.loginWithOTPCallback` verifies
      // against this exact same target when it doesn't find an `auth` record either.
      target: auth ? auth.id : email,
      exp: ttl,
    })

    // `auth` is only possibly `undefined` on the `selfRegistrationDispatch` path, which requires
    // `notifier === 'email'` above — so the `auth.phone` branch below only ever evaluates with a
    // real `auth`, the `?.` is defensive typing, not a reachable runtime case.
    const to = notifier === 'email' ? email : auth?.phone?.unmask()
    if (!to) {
      throw new HttpError('BAD_REQUEST', {
        message: `No ${notifier} destination on file for this account.`,
      })
    }

    const data = { code, ttl: ttl / 60 }
    await this.providers.get(NotifierProvider).sendMessage(notifier, {
      to,
      subject: notifier === 'email'
        ? (isLogin ? 'Your login code' : 'Password recovery')
        : undefined,
      zanixTemplate: notifier === 'email' ? (isLogin ? 'login-otp' : 'password-recovery') : 'otp',
      data,
    } as never, { useWorker: 'one-time' })

    return { response: RECOVERY_RESPONSE }
  }

  /**
   * Verifies a recovery/OTP-login `code` for `email` and issues session tokens on success. When
   * `password` is also given, it's persisted for the account first (the password-recovery case);
   * omitted, only the OTP is consumed (the plain OTP-login case).
   *
   * Issues the same configured `accessExpiration`/`refreshExpiration` as `AuthService.finishLogin`
   * (see that method's own doc for why).
   *
   * @throws {HttpError} `BAD_REQUEST` when `password` fails the active password policy (checked
   *   before `code` is consumed); `FORBIDDEN` when no account exists for `email`, or when `code` is
   *   invalid/expired (`ZanixAuthProvider.otp.authenticate`), or when the linked `users` profile
   *   is deactivated/deleted (`UsersRepository.assertActive`).
   */
  public async recoveryCallback(email: string, code: string, password?: string) {
    if (password !== undefined) this.assertPasswordPolicy(password)
    const auth = await this.providers.get(AuthRepository).findByEmail(
      email,
    ) as unknown as HydratedAuth
    if (!auth) throw new HttpError('FORBIDDEN', { message: 'Invalid email or code.' })
    await this.providers.get(UsersRepository).assertActive(auth.userId)

    const permissions = await permissionsForAccount(this.providers, auth)
    // Same cast as `AuthService.finishLogin` — see its own doc for why.
    const accessExpiration = resolveConfiguredAccessExpiration() as
      | AuthSessionOptions['accessExpiration']
      | undefined
    const refreshExpiration = resolveConfiguredRefreshExpiration() as
      | AuthSessionOptions['refreshExpiration']
      | undefined
    const tokens = await this.providers.get(ZanixAuthProvider).otp.authenticate(auth.id, code, {
      subject: auth.id,
      permissions,
      ...(accessExpiration !== undefined ? { accessExpiration } : {}),
      ...(refreshExpiration !== undefined ? { refreshExpiration } : {}),
    })

    await this.providers.get(AuthRepository).updateAuth({
      id: auth.id,
      ...(password ? { password } : {}),
      lastLoginAt: new Date(),
    }, { applyProtection: true, unset: password ? ['mustChangePassword'] : undefined })

    return { ...tokens, expiresAt: TOKEN_EXPIRATION }
  }

  /**
   * Applies `passwordPolicy` (`auth.app.ts`'s overridable `behaviors` slot) to a new password.
   *
   * @throws {HttpError} `BAD_REQUEST` carrying the policy's own message when it rejects `password`.
   */
  private assertPasswordPolicy(password: string): void {
    const policyResult = resolveBehavior<(password: string) => true | string>(
      'auth',
      'passwordPolicy',
    )?.(password) ?? true
    if (policyResult !== true) {
      throw new HttpError('BAD_REQUEST', { message: policyResult })
    }
  }
}
