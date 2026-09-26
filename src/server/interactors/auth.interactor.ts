import type { AuthenticationAttrs, HydratedAuth } from '../repositories/auth/model.defs.ts'

import type { AuthSessionOptions, GitHubOAuth2Connector, GoogleOAuth2Connector } from '@zanix/auth'
import type { PopulatedRole } from 'utils/rbac.ts'

import { Interactor, SESSION_HEADERS, ZanixInteractor } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import { createJWT, decodeJWT, JWT_KEY_ENV, verifyJWT, ZanixAuthProvider } from '@zanix/auth'
import { NotifierProvider } from '@zanix/notifications'
import { resolveBehavior, resolveConfig, resolveResource } from '@zanix/app/runtime'
import { AuthRepository } from '../repositories/auth/entity.provider.ts'
import { UsersRepository } from '../repositories/users/entity.provider.ts'
import { RolesRepository } from '../repositories/roles/entity.provider.ts'
import { PasswordService } from './password.interactor.ts'
import {
  LOGIN_ACTIONS,
  NOTIFIERS,
  REACTIVATION_TOKEN_EXPIRATION,
  REACTIVATION_TOKEN_PURPOSE,
  resolveConfiguredAccessExpiration,
  resolveConfiguredRefreshExpiration,
  SERVICE_ID,
  TOKEN_EXPIRATION,
} from 'utils/constants.ts'
import { resolveEffectivePermissions as defaultResolveEffectivePermissions } from 'utils/rbac.ts'

/** Resolves this service's own signing key for a fresh, self-issued token (never derived from an
 * existing token's `kid`, unlike `@zanix/auth`'s internal `getSecretByToken` — there is no existing
 * token to read a `kid` off of yet at mint time). Shared by `AuthService.challengeReactivation`
 * (signs) and `AuthService.confirmReactivation` (verifies) — the same env var
 * (`JWT_KEY_ENV`/`'JWT_KEY'`) every normal session token is already signed with in this project. */
function resolveJwtSigningSecret(): string {
  const secret = Deno.env.get(JWT_KEY_ENV)
  if (secret) return secret
  throw new HttpError('INTERNAL_SERVER_ERROR', {
    message: 'Authentication is not configured correctly.',
    cause: `Missing required JWT key in environment variables: ${JWT_KEY_ENV}.`,
    meta: { source: 'zanix', method: 'resolveJwtSigningSecret' },
    exposeCause: true,
  })
}

/**
 * Business logic for the `auth` domain's own login/session/2FA-enrollment flows. Password
 * change/recovery lives in the sibling `PasswordService` — see that file's own header for why
 * they're split.
 *
 * Every path that verifies credentials/a refresh token and is about to issue tokens also gates on
 * `UsersRepository.assertActive(auth.userId)` — the `users` profile's own `status` — so a
 * deactivated/deleted profile can neither log in nor keep refreshing an existing session. A no-op
 * when `auth.userId` is unset, so this never breaks against an `auth` record with no linked
 * profile (see that method's own doc).
 *
 * One deliberate carve-out to that hard block: a successful login via OAuth2
 * (`loginWithOauthCallback`) or email OTP (`loginWithOTPCallback`'s existing-account branch) offers
 * an `'INACTIVE'` profile a real way back to `'ACTIVE'` instead of rejecting it outright — the
 * counterpart to `UsersService.deactivateOwnAccount`'s own self-deactivate, which has no
 * self-service way back otherwise. This is NOT a silent auto-reactivation: once OTP/OAuth identity
 * verification succeeds, `challengeReactivation` mints a short-lived, single-purpose token instead
 * of finishing login, and the caller (an OTP/OAuth callback page) redirects to a real confirmation
 * screen (`.../login/reactivate/:token`) explaining that continuing will reactivate the account.
 * Only `confirmReactivation`, given that token back, actually reactivates
 * (`UsersRepository.reactivate`) and finishes login — see both methods' own doc for the full
 * mechanism. Every
 * OTHER `assertActive` call site (`loginWithPassword`, `loginWithTOTPCallback`,
 * `issueSessionForSubject`, `refreshTokens`, and the self-registration branch of
 * `loginWithOTPCallback` — where the account was just created and is always `'ACTIVE'`) stays a
 * hard, unmodified block. `'DELETED'` never reactivates through any path, including the two carved
 * out here.
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

    return this.finishLogin(auth, 'login')
  }

  /**
   * Requests an OTP login code for `email`, delegated to `PasswordService.recovery` (the OTP
   * generation/dispatch mechanism is shared between OTP-login and password-recovery — see that
   * method's own doc).
   *
   * @param options.is2FA When `true`, this call originates from a 2FA challenge (a password/
   *   OAuth2 login or a refresh whose account requires a second factor) rather than a direct
   *   OTP-login request — the response is then a second-factor challenge (`message`, `email`, and
   *   `method`: the channel the code went through).
   * @param options.notifier Overrides the account's own `otpNotifier` preference for THIS one
   *   dispatch only — e.g. a caller retrying a login-OTP request through a different channel
   *   because the configured one never arrived. Independent of `is2FA`: the 2FA challenge path
   *   (see this method's own one real caller, `AuthService.finishLogin`) always passes its own
   *   already-resolved `twoFactorAuthConfig.method` here, but a direct, primary OTP-login request
   *   (`LoginController.loginOtp`) can pass this too, on its own, with `is2FA` left unset.
   */
  public async loginWithOTP(
    email: string,
    options: { is2FA?: boolean; notifier?: typeof NOTIFIERS[number] } = {},
  ) {
    const { is2FA, notifier } = options
    const response = await this.interactors.get(PasswordService).recovery(email, {
      isLogin: true,
      notifier,
    })

    if (!is2FA) return response
    return {
      message: 'Two-factor authentication is enabled. A verification code has been sent.',
      email,
      method: notifier ?? NOTIFIERS[0],
    }
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
      // `defaultRoleId` — see `auth.app.ts`'s own config doc. Without a `roleId`,
      // `resolveSessionPermissions` below short-circuits to `[]`. Resolved identically in
      // `loginWithOauthCallback`, so both self-registration paths assign the same role.
      const roleId = resolveConfig<string>('auth', 'defaultRoleId') || undefined
      await this.providers.get(AuthRepository).registerAuth({ email, userId: profile.id, roleId })
      // Re-fetched rather than trusting the just-created document — same reasoning as
      // `loginWithOauthCallback`'s own identical re-fetch.
      auth = await this.providers.get(AuthRepository).findByEmail(
        email,
      ) as unknown as HydratedAuth
      await this.providers.get(NotifierProvider).email({
        to: email,
        subject: `Welcome to ${SERVICE_ID}`,
        zanixTemplate: 'welcome',
        data: {},
      }, { useWorker: 'one-time' })

      await this.providers.get(UsersRepository).assertActive(auth.userId)
      const permissions = await this.resolveSessionPermissions(auth.roleId)
      const tokens = await this.providers.get(ZanixAuthProvider).session.generateTokens({
        subject: auth.id,
        permissions,
        ...(accessExpiration !== undefined ? { accessExpiration } : {}),
        ...(refreshExpiration !== undefined ? { refreshExpiration } : {}),
      })
      await this.persistSession(auth.id)
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

    const permissions = await this.resolveSessionPermissions(auth.roleId)
    const tokens = await this.providers.get(ZanixAuthProvider).otp.authenticate(auth.id, code, {
      subject: auth.id,
      permissions,
      ...(accessExpiration !== undefined ? { accessExpiration } : {}),
      ...(refreshExpiration !== undefined ? { refreshExpiration } : {}),
    })

    // Only reached once `code` verifies successfully — see the block above for why this can't run
    // any earlier. Guarded on `userId` again (always set whenever `wasInactive` is true — `findById`
    // above only ever resolves a profile from a real one) purely to satisfy the type checker.
    //
    // `tokens` above are simply discarded here, never returned to the caller, when `wasInactive` —
    // minting them was an unavoidable side effect of `otp.authenticate` verifying `code` itself, but
    // this account isn't finishing login yet: see `challengeReactivation`'s own doc for why
    // reactivation waits for a real confirmation step instead of happening silently right here.
    if (wasInactive && userId) {
      return this.challengeReactivation(auth.id)
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
    // branch, `this.loginWithOTP(email, { is2FA: true, notifier: sFA.method })`) — that dispatch's
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
      return this.loginWithOTP(auth.email.unmask(), { is2FA: true, notifier: sFA.method })
    }

    await this.persistSession(auth.id)
    return { ...tokens, expiresAt: TOKEN_EXPIRATION }
  }

  /**
   * Mints a short-lived, single-purpose token confirming `authId` just passed a real OTP/OAuth
   * identity check while its linked account was `'INACTIVE'` — the caller (`loginWithOTPCallback`'s
   * existing-account branch, or `loginWithOauthCallback`) returns this INSTEAD OF finishing login,
   * so the owning page can redirect to a real confirmation screen
   * (`.../login/reactivate/:token`) rather than reactivating as a silent side effect. Only
   * `confirmReactivation`, given this exact token back, ever actually reactivates the account.
   *
   * The token carries only `sub` (`authId`) and a `purpose` claim (`REACTIVATION_TOKEN_PURPOSE`) —
   * signed with the same `JWT_KEY` every normal session token uses, but structurally distinct from
   * one (no session-shaped claims at all), so `AuthTokenValidation()`'s own guard elsewhere can
   * never mistake it for a real session token, and `confirmReactivation` itself rejects any token
   * not carrying this exact `purpose`. Expires quickly (`REACTIVATION_TOKEN_EXPIRATION`) — it only
   * ever needs to survive one redirect, never a real session lifetime.
   */
  private async challengeReactivation(
    authId: string,
  ): Promise<{ needsReactivationConfirm: true; reactivationToken: string }> {
    const reactivationToken = await createJWT(
      { sub: authId, purpose: REACTIVATION_TOKEN_PURPOSE },
      resolveJwtSigningSecret(),
      { expiration: REACTIVATION_TOKEN_EXPIRATION },
    )
    return { needsReactivationConfirm: true, reactivationToken }
  }

  /**
   * Completes the reactivation `challengeReactivation` deferred: verifies `reactivationToken`
   * (signature, expiry, and `purpose` — never trusts the raw `sub` claim without this), reactivates
   * the linked `'INACTIVE'` profile, and finishes login exactly like any other successful sign-in
   * from here on (`finishLogin`) — including honoring 2FA if the account has it configured, the
   * same as every other login path.
   *
   * A `'DELETED'` profile (deleted in the window between the original OTP/OAuth callback and this
   * confirmation) still hard-blocks here, same as everywhere else — this token proves a past
   * identity check, never a fresh guarantee that the account is still reactivatable.
   *
   * @throws {HttpError} `FORBIDDEN` when `reactivationToken` is invalid, expired, wasn't minted for
   *   this purpose, or no longer resolves to a real, non-`'DELETED'` account.
   */
  public async confirmReactivation(reactivationToken: string) {
    let payload
    try {
      payload = await verifyJWT(reactivationToken, resolveJwtSigningSecret())
    } catch {
      throw new HttpError('FORBIDDEN', {
        message: 'This reactivation link is invalid or has expired.',
      })
    }
    if (payload.purpose !== REACTIVATION_TOKEN_PURPOSE || typeof payload.sub !== 'string') {
      throw new HttpError('FORBIDDEN', {
        message: 'This reactivation link is invalid or has expired.',
      })
    }

    const auth = await this.providers.get(AuthRepository).findById(payload.sub) as
      | HydratedAuth
      | undefined
    if (!auth?.userId) {
      throw new HttpError('FORBIDDEN', { message: 'This account no longer exists.' })
    }
    const profile = await this.providers.get(UsersRepository).findById(auth.userId)
    if (profile?.status === 'DELETED') {
      throw new HttpError('FORBIDDEN', { message: 'This account no longer exists.' })
    }
    if (profile?.status === 'INACTIVE') {
      await this.providers.get(UsersRepository).reactivate(auth.userId)
    }
    return this.finishLogin(auth, 'login')
  }

  /**
   * Begins TOTP enrollment for the current authenticated session: generates a new secret and its
   * provisioning URI, WITHOUT persisting anything yet — `totpConfirm` must verify the user's
   * authenticator app actually holds this secret before it's stored on the account.
   *
   * **Resolves the account's real email before building the label**: `subject`
   * (`this.context.session.subject`) is the token's `sub` claim, which is `auth.id` (see every
   * `session.generateTokens({ subject: auth.id, ... })` call site in this file), never the login
   * email, while `totpProvisioningLabel`'s default (`auth.app.ts`) is the identity function
   * `(email) => email`. Falls back to `subject` only if the lookup finds nothing for an
   * authenticated session — never a crash over what's purely a QR-code display string.
   *
   * @throws {HttpError} `UNAUTHORIZED` when called with no authenticated session.
   */
  public async totpEnroll() {
    const subject = this.context.session?.subject
    if (!subject) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })

    const auth = await this.providers.get(AuthRepository).findById(subject) as
      | HydratedAuth
      | undefined
    const email = auth?.email?.unmask() ?? subject

    const totp = this.providers.get(ZanixAuthProvider).totp
    const secret = totp.generateSecret()
    const label =
      resolveBehavior<(email: string) => string>('auth', 'totpProvisioningLabel')?.(email) ??
        email
    const uri = totp.getProvisioningUri(secret, label, { issuer: SERVICE_ID })

    return { secret, uri }
  }

  /**
   * Confirms a TOTP enrollment: verifies `code` against `secret` (from a preceding `totpEnroll()`
   * call the client never round-tripped through storage) and, only on success, persists `secret`
   * on the current session's account and enables TOTP as its 2FA method on login.
   *
   * @throws {HttpError} `UNAUTHORIZED` with no authenticated session; `FORBIDDEN` if `code`
   *   doesn't match `secret`.
   */
  public async totpConfirm(secret: string, code: string) {
    const subject = this.context.session?.subject
    if (!subject) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })

    const window = resolveConfig<number>('auth', 'totpToleranceSteps') ?? 1
    const verified = await this.providers.get(ZanixAuthProvider).totp.verify(secret, code, {
      window,
    })
    if (!verified) throw new HttpError('FORBIDDEN', { message: 'Invalid TOTP code.' })

    const auth = await this.providers.get(AuthRepository).findById(subject) as
      | HydratedAuth
      | undefined

    await this.providers.get(AuthRepository).updateAuth({
      id: subject,
      totpSecret: secret,
      twoFactorAuthConfig: { method: 'totp', triggerOn: [...LOGIN_ACTIONS] },
    }, { applyProtection: true })

    if (auth?.email) {
      // `zanixTemplate` is typed against `@zanix/notifications`' own BUILT-IN registry only —
      // `'totp-enabled'` is a real, database-only template this project seeds itself
      // (`auth.app.ts`'s `setup`), genuinely unknown to that static type. Cast, not a mistake.
      await this.providers.get(NotifierProvider).email({
        to: auth.email.unmask(),
        subject: 'Two-factor authentication enabled',
        zanixTemplate: 'totp-enabled',
        data: {},
      } as never, { useWorker: 'one-time' })
    }

    return { response: 'TOTP enabled' }
  }

  /**
   * Disables TOTP (authenticator-app) 2FA for the caller's OWN account — the counterpart to
   * `totpConfirm`, clearing both the persisted `totpSecret` and the `twoFactorAuthConfig` that
   * enables it on login. Only writes when TOTP is actually the account's configured method — same
   * conditional-unset shape as `unlinkOauth`'s own `oauthProvider` check — since
   * `twoFactorAuthConfig.method` can also be an OTP notifier (`TWO_FACTOR_METHODS`), which this
   * must never clear.
   *
   * No "last remaining method" guard — see `unlinkOauth`'s own doc.
   *
   * @throws {HttpError} `UNAUTHORIZED` with no session; `FORBIDDEN` when the session subject no
   *   longer resolves to a real `auth` record.
   */
  public async disableTotp() {
    const authId = this.context.session?.subject
    if (!authId) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })

    const auth = await this.providers.get(AuthRepository).findById(authId) as
      | HydratedAuth
      | undefined
    if (!auth) throw new HttpError('FORBIDDEN', { message: 'Account not found.' })

    if (auth.twoFactorAuthConfig?.method === 'totp') {
      await this.providers.get(AuthRepository).updateAuth(
        { id: authId },
        { unset: ['totpSecret', 'twoFactorAuthConfig'] },
      )
    }
    return { response: 'TOTP disabled' }
  }

  /**
   * Begins phone verification for the current authenticated session: sends a one-time SMS code to
   * `phone`, WITHOUT persisting anything yet — `phoneConfirm` must verify the caller actually
   * received it before `auth.phone` is ever written (never set anywhere else in this project).
   * Verification is always by SMS regardless of which channel the caller later picks for their own
   * login-OTP preference (`setOtpNotifier`) — this step only proves phone ownership.
   *
   * Keyed under its OWN namespaced `target` (`phone-enroll:<subject>`), deliberately never the
   * same target `PasswordService.recovery`/`loginWithOTPCallback` use (the account id/email
   * directly) — a login-OTP request in flight for this same account must never verify against (or
   * invalidate) a phone-enrollment code, or vice versa.
   *
   * @throws {HttpError} `UNAUTHORIZED` when called with no authenticated session.
   */
  public async phoneEnroll(phone: string) {
    const subject = this.context.session?.subject
    if (!subject) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })

    const ttl = 300
    const code = await this.providers.get(ZanixAuthProvider).otp.generate({
      target: `phone-enroll:${subject}`,
      exp: ttl,
    })

    await this.providers.get(NotifierProvider).sendMessage('sms', {
      to: phone,
      zanixTemplate: 'otp',
      data: { code, ttl: ttl / 60 },
    } as never, { useWorker: 'one-time' })

    return { response: 'notification sent' }
  }

  /**
   * Confirms phone verification: verifies `code` against the SAME namespaced target
   * `phoneEnroll` generated it under and, only on success, persists `phone` on the current
   * session's account — the first and only place `auth.phone` is ever written in this project.
   * Deliberately does NOT also set `otpNotifier` here — verifying ownership and choosing a login
   * delivery channel are two separate actions (`setOtpNotifier`, below), so confirming a phone
   * never silently changes how an existing login-OTP preference is delivered.
   *
   * @throws {HttpError} `UNAUTHORIZED` with no session; `FORBIDDEN` if `code` doesn't verify.
   */
  public async phoneConfirm(phone: string, code: string) {
    const subject = this.context.session?.subject
    if (!subject) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })

    const verified = await this.providers.get(ZanixAuthProvider).otp.verify(
      `phone-enroll:${subject}`,
      code,
    )
    if (!verified) throw new HttpError('FORBIDDEN', { message: 'Invalid or expired code.' })

    await this.providers.get(AuthRepository).updateAuth({ id: subject, phone }, {
      applyProtection: true,
    })

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
   * @throws {HttpError} `UNAUTHORIZED` with no session; `FORBIDDEN` when the session subject no
   *   longer resolves to a real `auth` record.
   */
  public async disablePhone() {
    const authId = this.context.session?.subject
    if (!authId) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })

    const auth = await this.providers.get(AuthRepository).findById(authId) as
      | HydratedAuth
      | undefined
    if (!auth) throw new HttpError('FORBIDDEN', { message: 'Account not found.' })

    await this.providers.get(AuthRepository).updateAuth(
      { id: authId },
      { unset: ['phone', 'otpNotifier'] },
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
   * @throws {HttpError} `UNAUTHORIZED` with no session; `FORBIDDEN` when the session subject no
   *   longer resolves to a real `auth` record; `BAD_REQUEST` when `notifier` is `'sms'`/`'whatsapp'`
   *   and the account has no verified `phone` on file yet.
   */
  public async setOtpNotifier(notifier?: Exclude<typeof NOTIFIERS[number], 'email'> | '') {
    const authId = this.context.session?.subject
    if (!authId) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })

    const auth = await this.providers.get(AuthRepository).findById(authId) as
      | HydratedAuth
      | undefined
    if (!auth) throw new HttpError('FORBIDDEN', { message: 'Account not found.' })

    if (notifier && !auth.phone) {
      throw new HttpError('BAD_REQUEST', {
        message: 'Verify a phone number before choosing SMS/WhatsApp for your login code.',
      })
    }

    if (notifier) {
      await this.providers.get(AuthRepository).updateAuth({ id: authId, otpNotifier: notifier })
    } else {
      await this.providers.get(AuthRepository).updateAuth({ id: authId }, {
        unset: ['otpNotifier'],
      })
    }
    return { response: 'OTP delivery preference updated' }
  }

  /**
   * Verifies the authenticator-app `code` sent for `email`'s TOTP-secured login and, on success,
   * issues session tokens — the same configured `accessExpiration`/`refreshExpiration` as
   * `finishLogin` (see its own doc for why).
   *
   * @throws {HttpError} `FORBIDDEN` when the account has no TOTP secret enrolled, when the linked
   *   `users` profile is deactivated/deleted (`UsersRepository.assertActive`), or when `code`
   *   doesn't match.
   */
  public async loginWithTOTPCallback(email: string, code: string) {
    const auth = await this.providers.get(AuthRepository).findByEmail(
      email,
    ) as unknown as HydratedAuth
    const secret = await auth?.totpSecret?.decrypt()
    if (!secret) {
      throw new HttpError('FORBIDDEN', { message: 'TOTP is not enabled for this account.' })
    }
    await this.providers.get(UsersRepository).assertActive(auth.userId)

    const window = resolveConfig<number>('auth', 'totpToleranceSteps') ?? 1
    const permissions = await this.resolveSessionPermissions(auth.roleId)
    // Same cast as `finishLogin` — see its own doc for why.
    const accessExpiration = resolveConfiguredAccessExpiration() as
      | AuthSessionOptions['accessExpiration']
      | undefined
    const refreshExpiration = resolveConfiguredRefreshExpiration() as
      | AuthSessionOptions['refreshExpiration']
      | undefined
    const tokens = await this.providers.get(ZanixAuthProvider).totp.authenticate(secret, code, {
      subject: auth.id,
      permissions,
      ...(accessExpiration !== undefined ? { accessExpiration } : {}),
      ...(refreshExpiration !== undefined ? { refreshExpiration } : {}),
    }, { window })

    await this.persistSession(auth.id)
    return { ...tokens, expiresAt: TOKEN_EXPIRATION }
  }

  /**
   * Returns the authorization URL for `provider` (e.g. `'google'`), for the client to redirect
   * the user to.
   *
   * `state`, when given, is forwarded as-is into `@zanix/auth`'s own
   * `OAuth2Connector.generateAuthUrl({ state })` instead of letting it mint its own random value —
   * this is what lets the caller (`login/[oauth]/page.tsx`'s own `action`, via `@zanix/auth`'s own
   * `oauthStateIssueGuard`) persist the EXACT same value it's about to return in the URL as a
   * short-lived cookie, so `loginWithOauthCallback`'s own CSRF-protection round trip
   * (`oauthStateVerifyGuard`) has something real to compare the provider's callback against. This
   * method itself never reads/writes that cookie — only ever a caller-supplied string — keeping
   * this interactor free of any page-specific cookie concern.
   *
   * `loginHint`, when given, is forwarded as-is into `@zanix/auth`'s own
   * `OAuth2Connector.generateAuthUrl({ loginHint })` — pre-fills/pre-selects that account on the
   * provider's own chooser screen. The real shape this exists for: an already-authenticated caller
   * connecting a provider to their OWN account (`login/:oauth`'s own `?email=`, see
   * `OAuthAuthorizeSearchRTO`'s own doc) — this method itself stays anonymous-reachable and never
   * verifies the hint against anything; `linkOauth` (the real connect step) still independently
   * rejects a mismatched email regardless.
   *
   * @throws {HttpError} `BAD_REQUEST` when this project isn't configured for `provider` (its
   *   `resources` slot never resolved — see `auth.app.ts`).
   */
  public loginWithOauth(provider: OauthProviders, state?: string, loginHint?: string) {
    const connector = this.getOauthConnector(provider)
    if (!connector) {
      throw new HttpError('BAD_REQUEST', {
        message: `OAuth2 provider "${provider}" is not configured.`,
      })
    }
    return connector.generateAuthUrl({ state, loginHint })
  }

  /**
   * Completes an OAuth2 login for `provider`: exchanges the authorization `code` for the
   * provider's own user info (`validateCode` — the code-flow counterpart of a token-based
   * lookup), then issues this project's own session tokens for the resolved
   * email, creating the `auth` record on first login.
   *
   * Takes no `state` parameter of its own: the callback's CSRF-protection round trip
   * (`login/[oauth]/callback/page.tsx`'s own `@zanix/auth`-provided `oauthStateVerifyGuard`)
   * already rejects a missing/mismatched `state` before this method's `loader` call site ever
   * runs — by the time `code` reaches here, the request is already known to be a genuine
   * continuation of a flow this project itself started, never a forged callback URL.
   *
   * The OAuth2 credential is already verified (`connector.validateCode(code)`, below) by the time
   * this checks the linked `users` profile's `status`: `'DELETED'` still hard-blocks with the same
   * error `assertActive` throws elsewhere, but an `'INACTIVE'` profile gets
   * `challengeReactivation`'s `{ needsReactivationConfirm, reactivationToken }` instead of session
   * tokens — see this file's own header doc for the full carve-out.
   *
   * @throws {HttpError} `BAD_REQUEST` when this project isn't configured for `provider`;
   *   `FORBIDDEN` when the provider returns no verified email, when no account exists for the
   *   resolved email and `selfRegistrationViaOAuth` is disabled, or when the linked `users`
   *   profile is `'DELETED'`; `CONFLICT` when the resolved email is already registered through a
   *   different sign-in method (password or another OAuth2 provider).
   */
  public async loginWithOauthCallback(code: string, provider: OauthProviders) {
    const connector = this.getOauthConnector(provider)
    if (!connector) {
      throw new HttpError('BAD_REQUEST', {
        message: `OAuth2 provider "${provider}" is not configured.`,
      })
    }

    const user = await connector.validateCode(code) as {
      email: string | null
      verified_email?: boolean
    }
    // `verified_email` only exists on Google's own user-info shape (GitHub's plain `/user`
    // response carries no verification flag at all) — when present, an unverified email is
    // rejected outright rather than trusted for account matching. Every provider still requires
    // a real, non-null email — GitHub returns `null` for an account keeping it private.
    if (!user.email || user.verified_email === false) {
      throw new HttpError('FORBIDDEN', {
        message: `This ${provider} account has no verified email address available.`,
      })
    }
    const email = user.email

    let auth = await this.providers.get(AuthRepository).findByEmail(
      email,
    ) as unknown as HydratedAuth
    if (!auth) {
      // `selfRegistrationViaOAuth` gates whether an unrecognized email may auto-provision a new
      // account at all — see that config entry's own doc on `auth.app.ts` for why this lives
      // there (not a new `users` app layer).
      const allowSelfRegistration = resolveConfig<boolean>('auth', 'selfRegistrationViaOAuth') ??
        true
      if (!allowSelfRegistration) {
        throw new HttpError('FORBIDDEN', {
          message: 'No account exists for this email. Contact an administrator for access.',
        })
      }

      // A linked `users` profile is created alongside the `auth` record — same as
      // `UsersService.registerUser` — so this account is gated by `UsersRepository.assertActive`
      // exactly like every other one, and has somewhere to hold profile data later. No
      // first/last name is populated from the provider's own user-info response: its shape
      // (`given_name`/`family_name` on Google, a single unstructured `name` or nothing at all on
      // GitHub) isn't guaranteed enough to trust without per-provider parsing — left for the
      // account's own owner to fill in via `PATCH /users`.
      const profile = await this.providers.get(UsersRepository).registerUser({})
      // `defaultRoleId` — see `loginWithOTPCallback`'s own identical resolution and `auth.app.ts`'s
      // config doc.
      const roleId = resolveConfig<string>('auth', 'defaultRoleId') || undefined
      await this.providers.get(AuthRepository).registerAuth({
        email,
        oauthProvider: provider,
        userId: profile.id,
        roleId,
      })
      // Re-fetched (rather than trusting the just-created document directly) so `auth` goes
      // through the exact same hydration/data-policy path `findByEmail` already gives every
      // other caller — no second, parallel way to shape a `HydratedAuth`.
      auth = await this.providers.get(AuthRepository).findByEmail(email) as unknown as HydratedAuth
      await this.providers.get(NotifierProvider).email({
        to: email,
        subject: `Welcome to ${SERVICE_ID}`,
        zanixTemplate: 'welcome',
        data: {},
      }, { useWorker: 'one-time' })
    } else if (auth.oauthProvider !== provider) {
      // Deliberately NOT auto-linking a matching email to an account created through a
      // DIFFERENT method (password, or a different OAuth2 provider) — silently trusting email
      // equality across identity providers is a real account-takeover shape (a provider that
      // doesn't strictly verify email ownership could hand an attacker a token for a victim's
      // email, silently taking over their existing password-based account here). Login only ever
      // creates a NEW account or logs into one already linked to THIS SAME provider; connecting
      // another provider to an existing account is `linkOauth`'s job, behind an authenticated
      // session.
      throw new HttpError('CONFLICT', {
        message: 'An account already exists for this email with a different sign-in method.',
      })
    }

    // Not a plain `assertActive` here — see this file's own header doc and this method's own
    // doc for the reactivation carve-out. The OAuth2 credential is already verified above, so
    // there's no probe risk in checking status here (unlike the OTP branch, which caches it before
    // `code` verifies) — but reactivating is still never a silent side effect of this call: see
    // `challengeReactivation`'s own doc for why this returns a confirmation challenge instead.
    if (auth.userId) {
      const profile = await this.providers.get(UsersRepository).findById(auth.userId)
      if (profile?.status === 'DELETED') {
        throw new HttpError('FORBIDDEN', { message: 'This account no longer exists.' })
      }
      if (profile?.status === 'INACTIVE') {
        return this.challengeReactivation(auth.id)
      }
    }

    return this.finishLogin(auth, 'login', { oauthProvider: provider })
  }

  /**
   * Returns a plain, already-sanitized summary of the caller's OWN sign-in methods — never the
   * raw `auth` document. `password`/`totpSecret` are `access: 'internal'` fields precisely so a
   * generic serialization of the hydrated document could never safely reach a response; this
   * method reads them server-side ONLY to derive a boolean presence check, the same "never echo a
   * secret-shaped value, even for a presence check" discipline applied everywhere else in this
   * ecosystem — `phone` gets the same treatment, one step softer: the last 4 digits only, enough
   * for a settings screen to confirm which number is on file without echoing it in full. Backs a
   * self-service sign-in-methods settings screen, not an admin listing.
   *
   * @throws {HttpError} `UNAUTHORIZED` with no session; `FORBIDDEN` when the session subject no
   *   longer resolves to a real `auth` record.
   */
  public async getOwnAuthMethods() {
    const authId = this.context.session?.subject
    if (!authId) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })

    const auth = await this.providers.get(AuthRepository).findById(authId) as
      | HydratedAuth
      | undefined
    if (!auth) throw new HttpError('FORBIDDEN', { message: 'Account not found.' })

    return {
      email: auth.email.unmask(),
      hasPassword: Boolean(auth.password),
      oauthProvider: auth.oauthProvider ?? null,
      totpEnabled: auth.twoFactorAuthConfig?.method === 'totp',
      // Last 4 digits only — same "never echo a secret/PII-shaped value in full" discipline this
      // method's own doc already establishes for `password`/`totpSecret`; a settings screen only
      // ever needs to confirm WHICH number is on file, never the full number back.
      phone: auth.phone ? `••••${auth.phone.unmask().slice(-4)}` : null,
      otpNotifier: auth.otpNotifier ?? null,
    }
  }

  /**
   * Identifies which login method(s) are configured for `email` — the step-1 lookup for a
   * two-step login flow (collect an email first, then show the RIGHT next step: a password field
   * when one is set, or the existing OTP flow otherwise, the same GitHub-style shape
   * `LoginController.loginMethods`'s own doc describes). Public — no session exists yet at this
   * point in the flow, unlike `getOwnAuthMethods`'s own self-scoped, authenticated equivalent.
   *
   * **Security: deliberately never reveals whether `email` exists at all.** A nonexistent email
   * and an existing one with no password/OAuth2 method configured return the IDENTICAL
   * `{ hasPassword: false, oauthProviders: [] }` default — the same "no distinguishing response
   * shape" discipline `loginWithPassword`'s own doc applies to a bad password, extended here to an
   * endpoint that (unlike every other one in this controller) takes no secret at all, only a bare
   * email: without this default, a caller could enumerate every registered account by probing
   * emails one at a time and watching which ones return a non-empty method list — a classic
   * username/email-enumeration vector this is the one real defense against. A UI that gets the
   * default back simply falls through to the normal OTP flow, same as it would for any other
   * unrecognized email.
   *
   * `password`/`oauthProvider` are read server-side only to derive a boolean/list presence check,
   * never echoed themselves — the same "never echo a secret-shaped value, even for a presence
   * check" discipline `getOwnAuthMethods` already applies (see that method's own doc); this one
   * goes further and drops even the boolean-vs-absent distinction for a nonexistent account. Never
   * throws for a missing account — see above; `LoginController.loginMethods` pairs this with
   * `RateLimitGuard` (the same `criticalRateLimit` sensitivity as `loginOtp`'s own dispatch) as the
   * OTHER half of the real defense here — a uniform response shape alone doesn't stop a brute-force
   * probe of many candidate emails, only rate limiting does.
   *
   * `otpNotifier`/`hasVerifiedPhone` extend this same lookup for the OTP-login screen's own
   * "resend via a different channel" affordance — a caller needs to know, BEFORE ever calling
   * `loginOtp`, which channel a dispatch will actually use and whether any alternate is even
   * deliverable. `otpNotifier` follows `getOwnAuthMethods`'s own `AuthMethodsResult.otpNotifier`
   * convention exactly (`null` means `'email'`, the default) for the same field on the same
   * concept, just at the anonymous, pre-login lookup instead of the authenticated one. The same
   * non-enumeration default already governs both new fields: a nonexistent email resolves to
   * `otpNotifier: null, hasVerifiedPhone: false` — bit-for-bit what a REAL account with no
   * verified phone and no configured preference ALSO gets back (`auth?.otpNotifier` and
   * `auth?.phone` are both simply `undefined` for either case), so neither field adds a new way to
   * distinguish the two.
   */
  public async resolveLoginMethods(
    email: string,
  ): Promise<
    {
      hasPassword: boolean
      oauthProviders: OauthProviders[]
      otpNotifier: Exclude<typeof NOTIFIERS[number], 'email'> | null
      hasVerifiedPhone: boolean
    }
  > {
    const auth = await this.providers.get(AuthRepository).findByEmail(
      email,
    ) as unknown as HydratedAuth | undefined
    if (!auth) {
      return { hasPassword: false, oauthProviders: [], otpNotifier: null, hasVerifiedPhone: false }
    }

    return {
      hasPassword: Boolean(auth.password),
      oauthProviders: auth.oauthProvider ? [auth.oauthProvider] : [],
      otpNotifier: auth.otpNotifier ?? null,
      hasVerifiedPhone: Boolean(auth.phone),
    }
  }

  /**
   * Links `provider` to the CALLER'S OWN account (never a login, never account creation) on an
   * already-authenticated session. Deliberately stricter than
   * `loginWithOauthCallback`'s own account-matching: the provider's verified email must equal this
   * account's OWN `email` EXACTLY, not merely "not already used by someone else". This isn't
   * an arbitrary extra restriction — it's the only shape that works with the current schema: `loginWithOauth*` resolves an account purely by `findByEmail(providerEmail)`, so
   * persisting `oauthProvider` against an account whose stored `email` differs from the provider's
   * own verified email would link a method that could never again find its way back to this
   * account on a future login. Because `emailKeyId` is a unique index, requiring exact equality
   * against the CALLER'S OWN account also makes a separate "is this email already claimed by a
   * DIFFERENT account" lookup redundant (the auto-linking concern on `loginWithOauthCallback`'s own
   * doc doesn't apply here for that reason) — no other `auth` record could hold that same email in
   * the first place.
   *
   * @throws {HttpError} `UNAUTHORIZED` with no session; `BAD_REQUEST` when this project isn't
   *   configured for `provider`; `FORBIDDEN` when the session subject no longer resolves to a real
   *   `auth` record, or the provider returns no verified email; `CONFLICT` when the provider's own
   *   verified email doesn't match the caller's own account email.
   */
  public async linkOauth(code: string, provider: OauthProviders) {
    const authId = this.context.session?.subject
    if (!authId) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })

    const connector = this.getOauthConnector(provider)
    if (!connector) {
      throw new HttpError('BAD_REQUEST', {
        message: `OAuth2 provider "${provider}" is not configured.`,
      })
    }

    const auth = await this.providers.get(AuthRepository).findById(authId) as
      | HydratedAuth
      | undefined
    if (!auth) throw new HttpError('FORBIDDEN', { message: 'Account not found.' })

    const user = await connector.validateCode(code) as {
      email: string | null
      verified_email?: boolean
    }
    if (!user.email || user.verified_email === false) {
      throw new HttpError('FORBIDDEN', {
        message: `This ${provider} account has no verified email address available.`,
      })
    }

    if (user.email !== auth.email.unmask()) {
      throw new HttpError('CONFLICT', {
        message:
          `This ${provider} account's email doesn't match your own account's email. Sign in ` +
          `with that email directly instead of connecting a different one.`,
      })
    }

    await this.providers.get(AuthRepository).updateAuth({ id: authId, oauthProvider: provider })
    return { response: `${provider} connected` }
  }

  /**
   * Disconnects `provider` from the caller's OWN account. No
   * "last remaining method" guard: email+OTP (`loginWithOTP`/`loginWithOTPCallback`) resolves
   * purely from `AuthRepository.findByEmail`, never from `oauthProvider`/`password` — every
   * account can always fall back to it regardless of what else is disconnected, so there is no
   * real scenario where this call could lock the caller out. Adding a guard against a lockout this
   * schema already makes impossible would be misleading complexity, not a real safety net.
   *
   * @throws {HttpError} `UNAUTHORIZED` with no session; `FORBIDDEN` when the session subject no
   *   longer resolves to a real `auth` record.
   */
  public async unlinkOauth(provider: OauthProviders) {
    const authId = this.context.session?.subject
    if (!authId) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })

    const auth = await this.providers.get(AuthRepository).findById(authId) as
      | HydratedAuth
      | undefined
    if (!auth) throw new HttpError('FORBIDDEN', { message: 'Account not found.' })

    if (auth.oauthProvider === provider) {
      await this.providers.get(AuthRepository).updateAuth(
        { id: authId },
        { unset: ['oauthProvider', 'oauthRefreshToken'] },
      )
    }
    return { response: `${provider} disconnected` }
  }

  /**
   * Mints a fresh session for `authId` directly — the tail of `finishLogin` (permission resolution,
   * token issuance, `lastLoginAt`) without its own 2FA branch. For a caller that already knows this
   * `auth` record passed real authentication (2FA included, when configured) through some OTHER
   * means, and only needs the actual session tokens minted: `oauth-provider.interactor.ts`'s own
   * `OAuthProviderService.exchangeCode` is the one real caller — an authorization code is only ever
   * minted for a request that already carried a valid, currently authenticated iam session
   * (`OAuthProviderService.authorize`), so exchanging it for a session here re-running a 2FA
   * challenge would ask the same human to prove the same thing twice.
   *
   * @throws {HttpError} `FORBIDDEN` when no `auth` record exists for `authId`, or its linked
   *   `users` profile is deactivated/deleted (`UsersRepository.assertActive`).
   */
  public async issueSessionForSubject(authId: string) {
    const auth = await this.providers.get(AuthRepository).findById(authId) as
      | HydratedAuth
      | undefined
    if (!auth) throw new HttpError('FORBIDDEN', { message: 'Account not found.' })
    await this.providers.get(UsersRepository).assertActive(auth.userId)

    const permissions = await this.resolveSessionPermissions(auth.roleId)
    // Same cast as `finishLogin` — see its own doc for why.
    const accessExpiration = resolveConfiguredAccessExpiration() as
      | AuthSessionOptions['accessExpiration']
      | undefined
    const refreshExpiration = resolveConfiguredRefreshExpiration() as
      | AuthSessionOptions['refreshExpiration']
      | undefined
    const tokens = await this.providers.get(ZanixAuthProvider).session.generateTokens({
      subject: auth.id,
      permissions,
      ...(accessExpiration !== undefined ? { accessExpiration } : {}),
      ...(refreshExpiration !== undefined ? { refreshExpiration } : {}),
    })

    await this.providers.get(AuthRepository).updateAuth({
      id: auth.id,
      lastLoginAt: new Date(),
    }, { applyProtection: true })

    return { ...tokens, expiresAt: TOKEN_EXPIRATION }
  }

  /**
   * Best-effort, UNVERIFIED peek at a refresh token's own `sub` claim — so this account's CURRENT
   * permissions can be looked up and embedded into the refreshed tokens (`refreshTokens` below)
   * BEFORE `session.refreshTokens()` cryptographically verifies the token. This is safe: decode
   * and verify read the exact same signed bytes, so a tampered token can never decode to a subject
   * that verification would then go on to accept — if verification fails, `session.refreshTokens()`
   * still throws its own real, user-facing error regardless of what this speculatively returned.
   * Never throws itself, by design — a missing/malformed token here just means no permissions get
   * pre-resolved (`resolveSessionPermissions(undefined)` already short-circuits to `[]`), never a
   * premature error ahead of `session.refreshTokens()`'s own.
   *
   * Resolves `token` the same way `@zanix/auth`'s own `refreshSessionTokensBase` does — an
   * explicit `token`, falling back to the `SESSION_HEADERS.user.token` cookie — so the
   * cookie-based refresh path (`TokenRTO.token` is optional; see `login.handler.ts`) gets fresh
   * permissions too, not only an explicit-body-token refresh.
   */
  private decodeRefreshSubject(token?: string): string | undefined {
    const raw = token || this.context.cookies[SESSION_HEADERS.user.token as string]
    if (!raw) return undefined
    try {
      return decodeJWT(raw).payload.sub as string | undefined
    } catch {
      return undefined
    }
  }

  /**
   * Exchanges a refresh `token` for a new session token pair via `@zanix/auth`'s own
   * `session.refreshTokens()` — which owns single-use rotation, reuse detection, and a short
   * rotation-grace window that tolerates two legitimate
   * near-simultaneous requests presenting the SAME still-valid token (a browser prefetching a link
   * on hover then navigating it, a double click, two tabs on one session) instead of wrongly
   * rejecting the second one. That mechanism is backed by the `'cache'` core provider registered
   * unconditionally at this project's boot (`@zanix/datamaster/core`, loaded by `Zanix.start()`'s
   * own `defineCoreMetadata()`) — `ZanixAuthProvider`'s own `session` extension already always
   * forwards it internally (`this.cache`, inherited from `@zanix/server`'s `CoreBaseClass`), so no
   * extra wiring is needed at this call site for it to be active.
   *
   * This method does NOT additionally verify the presented token against a separately stored hash
   * of its own: a strict, exact-match, single-use gate on top of `@zanix/auth`'s own check would
   * have ZERO tolerance for a second concurrent request, defeating the grace window above —
   * rejecting a legitimate second request even where `@zanix/auth`'s own blocklist correctly hands
   * back the pair already issued to the first one. `@zanix/auth`'s blocklist alone enforces reuse
   * detection here.
   *
   * Also re-resolves this account's CURRENT permissions (the same `resolveSessionPermissions` a
   * login uses) and passes them as `session.refreshTokens`'s own `sessionOptions` override, so a
   * role reassignment made after the original login takes effect on the very next refresh — never
   * only on a full re-login. See `decodeRefreshSubject`'s own doc for how the account is looked up
   * safely ahead of `session.refreshTokens()`'s cryptographic verification, and
   * `RolesService.assignRole`'s own doc for why this makes a forced refresh-token revoke on
   * reassignment unnecessary.
   *
   * @throws {HttpError} `FORBIDDEN` when the refresh token is expired, invalid, revoked, or no
   *   account can be resolved for it, or when the linked `users` profile is deactivated/deleted
   *   (`UsersRepository.assertActive`, re-checked on every refresh, not just at login — a session
   *   deactivated mid-lifetime must stop being able to refresh past its current access token).
   */
  public async refreshTokens(token?: string) {
    const decodedSubject = this.decodeRefreshSubject(token)
    const auth = decodedSubject
      ? await this.providers.get(AuthRepository).findById(decodedSubject) as
        | HydratedAuth
        | undefined
      : undefined
    const permissions = await this.resolveSessionPermissions(auth?.roleId)

    // `oldToken`/`payload` (the verified token's own decoded claims) are deliberately excluded
    // from `tokens` below — `auth` is already resolved via `decodeRefreshSubject` ahead of this
    // call, and leaving either in would otherwise leak straight into the client-facing response
    // through the `{ ...tokens, ... }` return below.
    const { oldToken: _oldToken, payload: _payload, ...tokens } = await this.providers.get(
      ZanixAuthProvider,
    )
      .session
      .refreshTokens(token, { permissions })

    if (!auth) {
      throw new HttpError('FORBIDDEN', {
        message: 'Refresh token verification failed: the token is expired, invalid, or revoked.',
      })
    }
    await this.providers.get(UsersRepository).assertActive(auth.userId)

    await this.persistSession(auth.id)
    return { ...tokens, expiresAt: TOKEN_EXPIRATION }
  }

  /** Revokes `token`, blocklisting it via `@zanix/auth`'s own session-revocation mechanism. */
  public async revokeToken(token?: string) {
    await this.providers.get(ZanixAuthProvider).session.revokeToken(token)
    return { response: 'token revoked' }
  }

  /**
   * Shared tail of every successful primary-credential login (password, OAuth2): checks whether
   * 2FA applies for `action`, short-circuiting into the matching challenge dispatch when it does;
   * otherwise resolves the account's effective permissions, issues session tokens carrying them,
   * and records `lastLoginAt`. The issued tokens themselves are never mirrored into this project's
   * own storage — `@zanix/auth`'s JWT + blocklist mechanism is the sole source of truth for session
   * validity (see `refreshTokens`'s own doc for why no locally stored token hash is kept).
   *
   * `accessExpiration`/`refreshExpiration` are only ever passed to `session.generateTokens` when
   * `ACCESS_TOKEN_EXPIRATION_ENV`/`REFRESH_TOKEN_EXPIRATION_ENV` are actually configured
   * (`resolveConfiguredAccessExpiration`/`resolveConfiguredRefreshExpiration` return `undefined`
   * otherwise) — omitted rather than passed as an explicit default, so this stays decoupled from
   * whatever default `@zanix/auth` itself applies. This method mints tokens via
   * `session.generateTokens`; `loginWithOTPCallback`/`loginWithTOTPCallback`/
   * `PasswordService.recoveryCallback` mint theirs via `otp.authenticate`/`totp.authenticate`
   * instead, but apply this exact same configured `accessExpiration`/`refreshExpiration` — every
   * token this project issues, through whichever flow mints it, honors the same configured
   * lifetime.
   *
   * The cast below is required because `AuthSessionOptions.accessExpiration`/`refreshExpiration`
   * are typed as a narrow literal union (`'30m' | '1h' | number` / `'1w' | '1mo' | '6mo' | '1y'`)
   * even though `@zanix/auth`'s own runtime (`generateSessionTokens` → `parseTTL`) accepts any
   * `s|m|h|d|w|mo|y`-suffixed duration string — a configured value like `'45m'` or `'7d'` is
   * genuinely valid at runtime but doesn't structurally match that literal type. The same cast is
   * repeated at every other token-minting call site, for the identical reason.
   */
  private async finishLogin(
    auth: HydratedAuth,
    action: typeof LOGIN_ACTIONS[number],
    extra: Partial<AuthenticationAttrs> = {},
  ) {
    const sFA = auth.twoFactorAuthConfig
    if (sFA?.triggerOn.includes(action)) {
      if (sFA.method === 'totp') {
        // `email`: `loginWithOauthCallback` (unlike `loginWithPassword`) has no email of its own to
        // redirect a TOTP challenge onward with — the CALLER never typed one in (the OAuth2
        // provider resolves it), so it only exists here, inside
        // `auth` itself. Every OTHER caller already has this same value from elsewhere
        // (`loginWithPassword`'s own `email` argument, `login/otp/[email]/page.tsx`'s own URL
        // param) and can simply ignore it; harmless to include unconditionally rather than a
        // second, OAuth-only response shape.
        return {
          message: 'Two-factor authentication is enabled. Enter your authenticator code.',
          email: auth.email.unmask(),
          method: 'totp' as const,
        }
      }
      return this.loginWithOTP(auth.email.unmask(), { is2FA: true, notifier: sFA.method })
    }

    const permissions = await this.resolveSessionPermissions(auth.roleId)
    const accessExpiration = resolveConfiguredAccessExpiration() as
      | AuthSessionOptions['accessExpiration']
      | undefined
    const refreshExpiration = resolveConfiguredRefreshExpiration() as
      | AuthSessionOptions['refreshExpiration']
      | undefined
    const tokens = await this.providers.get(ZanixAuthProvider).session.generateTokens({
      subject: auth.id,
      permissions,
      ...(accessExpiration !== undefined ? { accessExpiration } : {}),
      ...(refreshExpiration !== undefined ? { refreshExpiration } : {}),
    })

    await this.providers.get(AuthRepository).updateAuth({
      id: auth.id,
      lastLoginAt: new Date(),
      ...extra,
    }, { applyProtection: true })

    return { ...tokens, expiresAt: TOKEN_EXPIRATION, mustChangePassword: auth.mustChangePassword }
  }

  /** Records `lastLoginAt` for `authId`, after a successful OTP/TOTP login or token refresh. */
  private persistSession(authId: string) {
    return this.providers.get(AuthRepository).updateAuth({
      id: authId,
      lastLoginAt: new Date(),
    }, { applyProtection: true })
  }

  /**
   * Resolves the effective, flat permission-code list for `roleId` (`[]` when the account has no
   * role assigned — an authenticated-but-unprivileged session, matching `AuthTokenValidation`
   * with no `permissions` option). Delegates the actual role→permissions evaluation to
   * `auth.app.ts`'s own `resolveEffectivePermissions` behavior, falling back to its default
   * (`utils/rbac.ts`'s own `resolveEffectivePermissions`) when no host override is registered or
   * no app was ever activated (e.g. this class's own unit tests) — same "override, else default"
   * precedence every other `resolveBehavior` call site in this file already follows (see
   * `totpProvisioningLabel` above) — so a host can swap in a different evaluation strategy (a
   * role hierarchy, an external policy engine, ...) without forking this method.
   *
   * Called from every LOGIN path (each call site above) AND from `refreshTokens`, via
   * `decodeRefreshSubject` — `@zanix/auth`'s `session.refreshTokens(token, sessionOptions)`
   * accepts a `sessionOptions` override merged over the refresh token's own originally-embedded
   * `AuthSessionOptions`, which is what makes re-resolving permissions on refresh (not just at
   * login) actually take effect. A role/permission change therefore takes effect on the very next
   * refresh, not only the next full login — see `refreshTokens`'s own doc, and
   * `RolesService.assignRole`'s own doc for why a forced refresh-token revoke on reassignment is
   * unnecessary.
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

  /**
   * The swappable OAuth2 connector instance `auth.app.ts` constructed for `provider` (its
   * `${provider}OAuth2` resource slot), or `undefined` if that provider was never configured
   * (`GOOGLE_OAUTH2_CLIENT_ID_ENV`/`GITHUB_OAUTH2_CLIENT_ID_ENV` unset — see `auth.app.ts`'s own
   * `resources` construction). Resolved standalone, outside any `RuntimeContext` — a
   * `ZanixInteractor` handling a request has none of its own.
   */
  private getOauthConnector(
    provider: OauthProviders,
  ): GoogleOAuth2Connector | GitHubOAuth2Connector | undefined {
    return resolveResource<GoogleOAuth2Connector | GitHubOAuth2Connector>(
      'auth',
      `${provider}OAuth2`,
    )
  }
}
