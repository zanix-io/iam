import type { HydratedAuth } from '../repositories/auth/model.defs.ts'
import type { AuthSessionOptions } from '@zanix/auth'
import { Interactor, ZanixInteractor } from '@zanix/server'
import { contextMessageLang } from 'utils/message-lang.ts'
import { HttpError } from '@zanix/errors'
import { ZanixAuthProvider } from '@zanix/auth'
import { NotifierProvider } from '@zanix/notifications'
import { resolveConfig } from '@zanix/app/runtime'
import { AuthRepository } from '../repositories/auth/entity.provider.ts'
import { UsersRepository } from '../repositories/users/entity.provider.ts'
import {
  NOTIFIERS,
  resolveConfiguredAccessExpiration,
  resolveConfiguredRefreshExpiration,
  TOKEN_EXPIRATION,
} from 'utils/constants.ts'
import { permissionsForAccount } from './session-permissions.ts'
import { authenticateAccountOtp, emailVerifiedPayload, recordEmailProof } from './email-proof.ts'
import { OauthService } from './oauth.interactor.ts'
import { PhoneService } from './phone.interactor.ts'
import { SessionService } from './session.interactor.ts'
import { TotpService } from './totp.interactor.ts'

/**
 * The entry point of the `login` routes and hosted pages: it verifies the password and email-code
 * sign-ins itself and hands every other operation to the interactor that owns it, so a route or
 * page binds to one class. Password change and recovery live in `PasswordService`.
 *
 * - `SessionService`: finishing a login, reactivation, issuing, refreshing and revoking sessions.
 * - `TotpService`: the authenticator app, backup codes and factor-change proofs.
 * - `PhoneService`: the verified phone and the passwordless-code channel.
 * - `OauthService`: OAuth2 sign-in and linking.
 */
@Interactor()
export class AuthService extends ZanixInteractor {
  /**
   * Authenticates a user by `email`/`password` and issues session tokens.
   *
   * If the account has 2FA configured to trigger on login (`twoFactorAuthConfig.triggerOn`
   * includes `'login'`), this short-circuits into the matching second-factor dispatch instead of
   * returning tokens directly.
   *
   * @throws {HttpError} `FORBIDDEN` when the account doesn't exist, the password doesn't match, or
   *   the linked `users` profile is deactivated/deleted — the same error either way, so a caller
   *   can't distinguish "no such account" from "wrong password" by response shape (an inactive
   *   account's own distinct message is an intentional exception — see `UsersRepository.assertActive`
   *   — it only ever fires after credentials already verified, so it leaks nothing to a guesser).
   */
  public async loginWithPassword(email: string, password: string) {
    const auth = await this.providers.get(AuthRepository).findByEmail(
      email,
    ) as unknown as HydratedAuth
    const canLogin = await auth?.password?.verify(password)
    if (!canLogin) {
      throw new HttpError('FORBIDDEN', { message: 'Invalid email or password.' })
    }
    await this.providers.get(UsersRepository).assertActive(auth.userId)

    return this.interactors.get(SessionService).finishLogin(auth, 'login')
  }

  /**
   * Verifies the OTP `code` sent to `email` and, on success, issues session tokens — the same
   * configured `accessExpiration`/`refreshExpiration` as `finishLogin` (see its own doc for why).
   *
   * **Honors `twoFactorAuthConfig` for an existing account**, same as `loginWithPassword`/
   * `confirmReactivation` (both end in `finishLogin`), so OTP login is never a second-factor
   * bypass. Only when the configured method actually differs from the channel this OTP was itself
   * delivered through, though — see the check's own inline doc, right where it's applied, for the
   * full reasoning and its one known, currently-unreachable gap.
   *
   * **No existing `auth` record for `email`** is not automatically a rejection: when
   * `PasswordService.recovery`'s own self-registration dispatch generated this code (`target:
   * email`, no account created yet — see that method's own doc), this is this project's real
   * passwordless-signup completion step. `code` is verified first, against that SAME `email`
   * target, via `otp.verify` — deliberately never `.authenticate`, which would mint a session with
   * `email` itself as `subject` rather than a real account id. Only once verification succeeds is
   * the account actually created (same shape as `loginWithOauthCallback`'s own auto-provisioning),
   * so an unrecognized email that never completes the code leaves no `auth`/`users` row behind —
   * account creation waits for a verified identity, not an unverified dispatch request.
   * `selfRegistrationViaOTP` (`auth.app.ts`) still gates whether this is allowed at all; disabled,
   * an unrecognized email's code is never treated as valid here even if it happens to match
   * (`recovery` wouldn't have dispatched one in the first place with the flag off, but this method
   * doesn't trust that invariant blindly).
   *
   * When an account DOES exist, an `'INACTIVE'` linked `users` profile does NOT hard-block this
   * login: once `code` verifies successfully, this returns `challengeReactivation`'s confirmation
   * token instead of session tokens — acting on status any earlier would let anyone reactivate (or
   * probe the status of) an inactive account by supplying its email with no valid code at all. A
   * `'DELETED'` profile still hard-blocks immediately, before `code` is even checked — see this
   * file's own header doc for the full carve-out.
   *
   * @throws {HttpError} `FORBIDDEN` when no account exists for `email` and self-registration is
   *   disabled or `code` doesn't verify against the email-keyed target; when an account DOES
   *   exist, `FORBIDDEN` when the linked `users` profile is `'DELETED'`, or when `code` is
   *   invalid/expired (`ZanixAuthProvider.otp.authenticate`).
   * @returns Session tokens; a 2FA challenge response when the account's `twoFactorAuthConfig`
   *   requires one; or `{ needsReactivationConfirm, reactivationToken }` for an `'INACTIVE'`
   *   profile.
   */
  public async loginWithOTPCallback(email: string, code: string) {
    let auth = await this.providers.get(AuthRepository).findByEmail(
      email,
    ) as unknown as HydratedAuth
    // Same cast as `finishLogin` — see its own doc for why.
    const accessExpiration = resolveConfiguredAccessExpiration() as
      | AuthSessionOptions['accessExpiration']
      | undefined
    const refreshExpiration = resolveConfiguredRefreshExpiration() as
      | AuthSessionOptions['refreshExpiration']
      | undefined

    if (!auth) {
      const allowSelfRegistration = resolveConfig<boolean>('auth', 'selfRegistrationViaOTP') ?? true
      const isValid = allowSelfRegistration &&
        await this.providers.get(ZanixAuthProvider).otp.verify(email, code)
      if (!isValid) throw new HttpError('FORBIDDEN', { message: 'Invalid email or code.' })

      // No first/last name populated from an OTP code — there's no provider profile response to
      // draw one from at all here, same as `loginWithOauthCallback`'s own reasoning for GitHub.
      const profile = await this.providers.get(UsersRepository).registerUser({})
      // `defaultRoleId` — see `auth.app.ts`'s own config doc. Without a role,
      // `permissionsForAccount` below short-circuits to `[]`. Resolved identically in
      // `loginWithOauthCallback`, so both self-registration paths assign the same role.
      const defaultRole = resolveConfig<string>('auth', 'defaultRoleId') || undefined
      const roleIds = defaultRole ? [defaultRole] : undefined
      // The code was delivered to `email` and has just verified, so the new account has already
      // proven its mailbox.
      await this.providers.get(AuthRepository).registerAuth({
        email,
        userId: profile.id,
        roleIds,
        emailVerifiedAt: new Date(),
      })
      // Re-fetched rather than trusting the just-created document — same reasoning as
      // `loginWithOauthCallback`'s own identical re-fetch.
      auth = await this.providers.get(AuthRepository).findByEmail(
        email,
      ) as unknown as HydratedAuth
      await this.providers.get(NotifierProvider).email({
        to: email,
        zanixTemplate: 'welcome',
        lang: contextMessageLang(this.context),
        data: {},
      }, { useWorker: 'one-time' })

      await this.providers.get(UsersRepository).assertActive(auth.userId)
      const permissions = await permissionsForAccount(this.providers, auth)
      const tokens = await this.providers.get(ZanixAuthProvider).session.generateTokens({
        subject: auth.id,
        permissions,
        ...emailVerifiedPayload(true),
        ...(accessExpiration !== undefined ? { accessExpiration } : {}),
        ...(refreshExpiration !== undefined ? { refreshExpiration } : {}),
      })
      await this.interactors.get(SessionService).persistSession(auth.id)
      return { ...tokens, expiresAt: TOKEN_EXPIRATION }
    }

    // Reaching here means `email` already has an `auth` record — created via password, OAuth2, or
    // a prior OTP signup, this method doesn't distinguish which. A verified code for that email
    // always logs into THIS account: correct auto-linking when the person who owns the inbox is
    // also who created the account, but indistinguishable here from someone else gaining access to
    // that inbox and taking over an account they never created. An accepted trade-off; an extra
    // confirmation step the first time a new method links to an account with another method
    // already active would harden it.
    //
    // Deliberately NOT a plain `assertActive` call here — see this file's own header doc for the
    // reactivation carve-out. `'DELETED'` still hard-blocks immediately, same as `assertActive`,
    // BEFORE `code` is even checked (that account can never legitimately resurrect, so leaking
    // nothing extra by checking early). An `'INACTIVE'` status is deliberately NOT acted on yet —
    // only cached — otherwise anyone could reactivate (or probe the status of) an inactive account
    // by supplying its email with no valid code at all.
    const userId = auth.userId
    const profile = await this.providers.get(UsersRepository).findById(userId)
    if (profile?.status === 'DELETED') {
      throw new HttpError('FORBIDDEN', { message: 'This account no longer exists.' })
    }
    const wasInactive = profile?.status === 'INACTIVE'

    const permissions = await permissionsForAccount(this.providers, auth)
    const { tokens, channel } = await authenticateAccountOtp(this.providers, auth, code, {
      subject: auth.id,
      permissions,
      ...(accessExpiration !== undefined ? { accessExpiration } : {}),
      ...(refreshExpiration !== undefined ? { refreshExpiration } : {}),
    })
    // A verified email code proves the mailbox, whatever the account's status or second factor
    // decides next.
    if (channel === 'email') await recordEmailProof(this.providers, auth.id)

    // Only reached once `code` verifies successfully — see the block above for why this can't run
    // any earlier. Guarded on `userId` again (always set whenever `wasInactive` is true — `findById`
    // above only ever resolves a profile from a real one) purely to satisfy the type checker.
    //
    // `tokens` above are simply discarded here, never returned to the caller, when `wasInactive` —
    // minting them was an unavoidable side effect of `otp.authenticate` verifying `code` itself, but
    // this account isn't finishing login yet: see `challengeReactivation`'s own doc for why
    // reactivation waits for a real confirmation step instead of happening silently right here.
    if (wasInactive && userId) {
      return this.interactors.get(SessionService).challengeReactivation(auth.id)
    }

    // `loginWithPassword`/`confirmReactivation` gate on `twoFactorAuthConfig` through
    // `finishLogin`; this direct OTP-login path applies the same gate here, so an account whose ONE
    // configured login method is OTP can't bypass its second factor.
    //
    // `sFA.method !== (auth.otpNotifier ?? NOTIFIERS[0])` — never a second factor over the SAME
    // channel `code` was already delivered through: the code just verified above already proves
    // control of that channel, so re-asking for it would be theater, not a real second factor.
    // `auth.otpNotifier ?? NOTIFIERS[0]` mirrors `PasswordService.recovery`'s own identical default
    // resolution exactly (that method's own doc) — the account's stored delivery preference is the
    // one this login's own OTP was dispatched through, absent an explicit per-request override this
    // callback has no way to see at verify time (see the last paragraph below for the one known
    // gap this leaves).
    //
    // For `sFA.method === 'totp'` (this project's own real configuration) this is unconditional:
    // `'totp'` is never itself a `NOTIFIERS` value, so the comparison always holds — exactly
    // matching `loginWithPassword`'s own behavior, since TOTP's own verification never reaches this
    // method at all (`loginWithTOTPCallback` is a fully separate endpoint).
    //
    // Deliberately NOT applied to `loginWithPassword`'s own 2FA dispatch (`finishLogin`'s non-totp
    // branch, `this.interactors.get(SessionService).loginWithOTP(email, { is2FA: true, notifier: sFA.method })`) — that dispatch's
    // own code is ALSO verified through this exact method, with no per-request signal telling the
    // two apart from a direct OTP-login attempt. `sFA.method` there is passed as an explicit
    // override, which may differ from `auth.otpNotifier`'s stored default — a latent gap shared
    // with (not introduced by) `finishLogin`'s own design, currently unreachable in practice since
    // nothing in this project ever configures a NON-`'totp'` `twoFactorAuthConfig.method` (the only
    // real write path, `totpConfirm`, always sets `'totp'`). A consumer that DOES enable a
    // notifier-based second factor should track which channel each dispatch used (e.g. alongside
    // the OTP record itself) before relying on this check for that combination.
    const sFA = auth.twoFactorAuthConfig
    if (sFA?.triggerOn.includes('login') && sFA.method !== (auth.otpNotifier ?? NOTIFIERS[0])) {
      if (sFA.method === 'totp') {
        return {
          message: 'Two-factor authentication is enabled. Enter your authenticator code.',
          email: auth.email.unmask(),
          method: 'totp' as const,
        }
      }
      return this.interactors.get(SessionService).loginWithOTP(auth.email.unmask(), {
        is2FA: true,
        notifier: sFA.method,
      })
    }

    await this.interactors.get(SessionService).persistSession(auth.id)
    return { ...tokens, expiresAt: TOKEN_EXPIRATION }
  }

  /** See `SessionService.confirmReactivation`. */
  public confirmReactivation(...args: Parameters<SessionService['confirmReactivation']>) {
    return this.interactors.get(SessionService).confirmReactivation(...args)
  }

  /** See `SessionService.issueSessionForSubject`. */
  public issueSessionForSubject(...args: Parameters<SessionService['issueSessionForSubject']>) {
    return this.interactors.get(SessionService).issueSessionForSubject(...args)
  }

  /** See `SessionService.refreshTokens`. */
  public refreshTokens(...args: Parameters<SessionService['refreshTokens']>) {
    return this.interactors.get(SessionService).refreshTokens(...args)
  }

  /** See `SessionService.revokeToken`. */
  public revokeToken(...args: Parameters<SessionService['revokeToken']>) {
    return this.interactors.get(SessionService).revokeToken(...args)
  }

  /** See `SessionService.loginWithOTP`. */
  public loginWithOTP(...args: Parameters<SessionService['loginWithOTP']>) {
    return this.interactors.get(SessionService).loginWithOTP(...args)
  }

  /** See `TotpService.totpEnroll`. */
  public totpEnroll(...args: Parameters<TotpService['totpEnroll']>) {
    return this.interactors.get(TotpService).totpEnroll(...args)
  }

  /** See `TotpService.totpConfirm`. */
  public totpConfirm(...args: Parameters<TotpService['totpConfirm']>) {
    return this.interactors.get(TotpService).totpConfirm(...args)
  }

  /** See `TotpService.provideFactorChangeProof`. */
  public provideFactorChangeProof(...args: Parameters<TotpService['provideFactorChangeProof']>) {
    return this.interactors.get(TotpService).provideFactorChangeProof(...args)
  }

  /** See `TotpService.requestFactorChangeProof`. */
  public requestFactorChangeProof(...args: Parameters<TotpService['requestFactorChangeProof']>) {
    return this.interactors.get(TotpService).requestFactorChangeProof(...args)
  }

  /** See `TotpService.disableTotp`. */
  public disableTotp(...args: Parameters<TotpService['disableTotp']>) {
    return this.interactors.get(TotpService).disableTotp(...args)
  }

  /** See `TotpService.regenerateBackupCodes`. */
  public regenerateBackupCodes(...args: Parameters<TotpService['regenerateBackupCodes']>) {
    return this.interactors.get(TotpService).regenerateBackupCodes(...args)
  }

  /** See `TotpService.loginWithTOTPCallback`. */
  public loginWithTOTPCallback(...args: Parameters<TotpService['loginWithTOTPCallback']>) {
    return this.interactors.get(TotpService).loginWithTOTPCallback(...args)
  }

  /** See `PhoneService.phoneEnroll`. */
  public phoneEnroll(...args: Parameters<PhoneService['phoneEnroll']>) {
    return this.interactors.get(PhoneService).phoneEnroll(...args)
  }

  /** See `PhoneService.phoneConfirm`. */
  public phoneConfirm(...args: Parameters<PhoneService['phoneConfirm']>) {
    return this.interactors.get(PhoneService).phoneConfirm(...args)
  }

  /** See `PhoneService.disablePhone`. */
  public disablePhone(...args: Parameters<PhoneService['disablePhone']>) {
    return this.interactors.get(PhoneService).disablePhone(...args)
  }

  /** See `PhoneService.setOtpNotifier`. */
  public setOtpNotifier(...args: Parameters<PhoneService['setOtpNotifier']>) {
    return this.interactors.get(PhoneService).setOtpNotifier(...args)
  }

  /** See `OauthService.loginWithOauth`. */
  public loginWithOauth(...args: Parameters<OauthService['loginWithOauth']>) {
    return this.interactors.get(OauthService).loginWithOauth(...args)
  }

  /** See `OauthService.loginWithOauthCallback`. */
  public loginWithOauthCallback(...args: Parameters<OauthService['loginWithOauthCallback']>) {
    return this.interactors.get(OauthService).loginWithOauthCallback(...args)
  }

  /** See `OauthService.getOwnAuthMethods`. */
  public getOwnAuthMethods(...args: Parameters<OauthService['getOwnAuthMethods']>) {
    return this.interactors.get(OauthService).getOwnAuthMethods(...args)
  }

  /** See `OauthService.resolveLoginMethods`. */
  public resolveLoginMethods(...args: Parameters<OauthService['resolveLoginMethods']>) {
    return this.interactors.get(OauthService).resolveLoginMethods(...args)
  }

  /** See `OauthService.linkOauth`. */
  public linkOauth(...args: Parameters<OauthService['linkOauth']>) {
    return this.interactors.get(OauthService).linkOauth(...args)
  }

  /** See `OauthService.unlinkOauth`. */
  public unlinkOauth(...args: Parameters<OauthService['unlinkOauth']>) {
    return this.interactors.get(OauthService).unlinkOauth(...args)
  }
}
