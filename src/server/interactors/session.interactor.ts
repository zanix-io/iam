import type { AuthenticationAttrs, HydratedAuth } from '../repositories/auth/model.defs.ts'
import type { AuthSessionOptions } from '@zanix/auth'
import { Interactor, SESSION_HEADERS, ZanixInteractor } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import { createJWT, decodeJWT, JWT_KEY_ENV, verifyJWT, ZanixAuthProvider } from '@zanix/auth'
import { AuthRepository } from '../repositories/auth/entity.provider.ts'
import { UsersRepository } from '../repositories/users/entity.provider.ts'
import { PasswordService } from './password.interactor.ts'
import {
  type LOGIN_ACTIONS,
  NOTIFIERS,
  REACTIVATION_TOKEN_EXPIRATION,
  REACTIVATION_TOKEN_PURPOSE,
  resolveConfiguredAccessExpiration,
  resolveConfiguredRefreshExpiration,
  TOKEN_EXPIRATION,
} from 'utils/constants.ts'
import { permissionsForAccount } from './session-permissions.ts'
import { emailVerifiedPayload } from './email-proof.ts'

/** Resolves this service's own signing key for a fresh, self-issued token (never derived from an
 * existing token's `kid`, unlike `@zanix/auth`'s internal `getSecretByToken` — there is no existing
 * token to read a `kid` off of yet at mint time). Shared by `SessionService.challengeReactivation`
 * (signs) and `SessionService.confirmReactivation` (verifies) — the same env var
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
 * Completes sign-ins and owns the session: the one place a login becomes tokens (`finishLogin`),
 * the passwordless code dispatch (`loginWithOTP`), reactivation of a deactivated account and the
 * token lifecycle (`issueSessionForSubject`, `refreshTokens`, `revokeToken`).
 *
 * Every path that verifies credentials or a refresh token and is about to issue tokens also gates
 * on `UsersRepository.assertActive(auth.userId)`, the `users` profile's own `status`, so a
 * deactivated or deleted profile can neither log in nor keep refreshing an existing session. It is
 * a no-op when `auth.userId` is unset (see that method's own doc).
 *
 * One deliberate carve-out: a successful OAuth2 login (`OauthService.loginWithOauthCallback`) or
 * email-code login (`AuthService.loginWithOTPCallback`, existing-account branch) offers an
 * `'INACTIVE'` profile a way back to `'ACTIVE'` instead of rejecting it. It is not a silent
 * reactivation: once the identity is verified, `challengeReactivation` mints a short-lived,
 * single-purpose token instead of finishing the login, and the caller redirects to a confirmation
 * screen (`.../login/reactivate/:token`) explaining that continuing reactivates the account. Only
 * `confirmReactivation`, given that token back, reactivates (`UsersRepository.reactivate`) and
 * finishes the login. Every other `assertActive` call site stays a hard block, and `'DELETED'`
 * never reactivates through any path.
 */
@Interactor()
export class SessionService extends ZanixInteractor {
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
   *   (see this method's own one real caller, `SessionService.finishLogin`) always passes its own
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
  public async challengeReactivation(
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

    const permissions = await permissionsForAccount(this.providers, auth)
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
      ...emailVerifiedPayload(Boolean(auth.emailVerifiedAt)),
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
   * pre-resolved (`permissionsForAccount(undefined)` already short-circuits to `[]`), never a
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
   * Also re-resolves this account's CURRENT permissions (the same `permissionsForAccount` a
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
    const permissions = await permissionsForAccount(this.providers, auth)

    // `oldToken`/`payload` (the verified token's own decoded claims) are deliberately excluded
    // from `tokens` below — `auth` is already resolved via `decodeRefreshSubject` ahead of this
    // call, and leaving either in would otherwise leak straight into the client-facing response
    // through the `{ ...tokens, ... }` return below.
    const { oldToken: _oldToken, payload: _payload, ...tokens } = await this.providers.get(
      ZanixAuthProvider,
    )
      .session
      .refreshTokens(token, {
        permissions,
        ...emailVerifiedPayload(Boolean(auth?.emailVerifiedAt)),
      })

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
  public async finishLogin(
    auth: HydratedAuth,
    action: typeof LOGIN_ACTIONS[number],
    extra: Partial<AuthenticationAttrs> = {},
    emailVerified: boolean = Boolean(auth.emailVerifiedAt),
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

    const permissions = await permissionsForAccount(this.providers, auth)
    const accessExpiration = resolveConfiguredAccessExpiration() as
      | AuthSessionOptions['accessExpiration']
      | undefined
    const refreshExpiration = resolveConfiguredRefreshExpiration() as
      | AuthSessionOptions['refreshExpiration']
      | undefined
    const tokens = await this.providers.get(ZanixAuthProvider).session.generateTokens({
      subject: auth.id,
      permissions,
      ...emailVerifiedPayload(emailVerified),
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
  public persistSession(authId: string) {
    return this.providers.get(AuthRepository).updateAuth({
      id: authId,
      lastLoginAt: new Date(),
    }, { applyProtection: true })
  }
}
