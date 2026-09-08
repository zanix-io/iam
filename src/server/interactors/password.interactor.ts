import type { HydratedAuth } from '../repositories/auth/model.defs.ts'
import type { AuthSessionOptions } from '@zanix/auth'
import type { PopulatedRole } from 'utils/rbac.ts'

import { Interactor, ZanixInteractor } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import { ZanixAuthProvider } from '@zanix/auth'
import { NotifierProvider } from '@zanix/notifications'
import { resolveBehavior } from '@zanix/app/runtime'
import { AuthRepository } from '../repositories/auth/entity.provider.ts'
import { UsersRepository } from '../repositories/users/entity.provider.ts'
import { RolesRepository } from '../repositories/roles/entity.provider.ts'
import {
  NOTIFIERS,
  resolveConfiguredAccessExpiration,
  resolveConfiguredRefreshExpiration,
  TOKEN_EXPIRATION,
} from 'utils/constants.ts'
import { resolveEffectivePermissions as defaultResolveEffectivePermissions } from 'utils/rbac.ts'

/**
 * Password change/recovery flows — split from `AuthService` (login/session/2FA-enrollment) the
 * same way the real, deployed sibling project this domain slice is grounded on splits them; the
 * OTP-generation mechanism is genuinely shared (`recovery`/`recoveryCallback` back both password
 * recovery AND `AuthService.loginWithOTP`'s own OTP-login flow, AND `UsersService.registerUser`'s
 * own no-password invite path).
 *
 * `recovery`/`recoveryCallback`/`changePwd` all gate on `UsersRepository.assertActive` the same
 * way `AuthService`'s own login paths do — see that file's own header doc.
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

    const policyResult = resolveBehavior<(password: string) => true | string>(
      'auth',
      'passwordPolicy',
    )?.(newPassword) ?? true
    if (policyResult !== true) {
      throw new HttpError('BAD_REQUEST', { message: policyResult })
    }

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
   * Generates an OTP (5-minute TTL) for `email`'s account and dispatches it through `notifier`
   * via `@zanix/notifications`' `NotifierProvider` — email uses this package's built-in
   * `login-otp`/`password-recovery` templates, SMS/WhatsApp use its built-in `otp` template
   * (shared across both, see `notifications-connectors`). Shared by both the OTP-login flow
   * (`AuthService.loginWithOTP`) and a direct password-recovery request — only the delivered
   * template differs (`isLogin`), the underlying OTP generation is identical.
   *
   * @throws {HttpError} `FORBIDDEN` when no account exists for `email`; `BAD_REQUEST` when
   *   `notifier` is `'sms'`/`'whatsapp'` and the account has no `phone` on file.
   * @returns A generic dispatch confirmation, never the OTP code itself.
   */
  public async recovery(
    email: string,
    options: { isLogin?: boolean; notifier?: typeof NOTIFIERS[number] } = {},
  ): Promise<{ response: string }> {
    const { notifier = NOTIFIERS[0], isLogin } = options

    const auth = await this.providers.get(AuthRepository).findByEmail(
      email,
    ) as unknown as HydratedAuth
    if (!auth) throw new HttpError('FORBIDDEN', { message: 'No account for this email.' })
    await this.providers.get(UsersRepository).assertActive(auth.userId)

    const ttl = 300
    const code = await this.providers.get(ZanixAuthProvider).otp.generate({
      target: auth.id,
      exp: ttl,
    })

    const to = notifier === 'email' ? email : auth.phone?.unmask()
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

    return { response: 'notification sent' }
  }

  /**
   * Verifies a recovery/OTP-login `code` for `email` and issues session tokens on success. When
   * `password` is also given, it's persisted for the account first (the password-recovery case);
   * omitted, only the OTP is consumed (the plain OTP-login case) — the same shared shape the
   * real, deployed sibling project's own `recoveryCallback` uses.
   *
   * Issues the same configured `accessExpiration`/`refreshExpiration` as `AuthService.finishLogin`
   * (see that method's own doc for why).
   *
   * @throws {HttpError} `FORBIDDEN` when no account exists for `email`, or when `code` is
   *   invalid/expired (`ZanixAuthProvider.otp.authenticate`), or when the linked `users` profile
   *   is deactivated/deleted (`UsersRepository.assertActive`).
   */
  public async recoveryCallback(email: string, code: string, password?: string) {
    const auth = await this.providers.get(AuthRepository).findByEmail(
      email,
    ) as unknown as HydratedAuth
    if (!auth) throw new HttpError('FORBIDDEN', { message: 'Invalid email or code.' })
    await this.providers.get(UsersRepository).assertActive(auth.userId)

    const permissions = await this.resolveSessionPermissions(auth.roleId)
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
   * Resolves the effective, flat permission-code list for `roleId` — same mechanism as
   * `AuthService.resolveSessionPermissions`'s own (more detailed) doc; kept as a small, separate
   * private method here rather than a shared cross-interactor helper, matching this project's own
   * established preference for small local helpers over a new cross-cutting abstraction (see e.g.
   * `UsersService.resolveOwnAuth`). `PasswordService` has no refresh flow of its own — `recovery`/
   * `recoveryCallback` are both login-equivalent paths — so unlike `AuthService`, there's no
   * separate refresh-time re-resolution to reuse this from.
   */
  private async resolveSessionPermissions(roleId?: string): Promise<string[]> {
    if (!roleId) return []
    const role = await this.providers.get(RolesRepository).findById(roleId, {
      populate: 'permissions',
    }) as PopulatedRole
    const strategy = resolveBehavior<(role: PopulatedRole) => string[]>(
      'auth',
      'resolveEffectivePermissions',
    ) ?? defaultResolveEffectivePermissions
    return strategy(role)
  }
}
