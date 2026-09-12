import type { AuthenticationAttrs, HydratedAuth } from '../repositories/auth/model.defs.ts'

import type { AuthSessionOptions, GitHubOAuth2Connector, GoogleOAuth2Connector } from '@zanix/auth'
import type { PopulatedRole } from 'utils/rbac.ts'

import { Interactor, SESSION_HEADERS, ZanixInteractor } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import { decodeJWT, ZanixAuthProvider } from '@zanix/auth'
import { NotifierProvider } from '@zanix/notifications'
import { resolveBehavior, resolveConfig, resolveResource } from '@zanix/app/runtime'
import { AuthRepository } from '../repositories/auth/entity.provider.ts'
import { UsersRepository } from '../repositories/users/entity.provider.ts'
import { RolesRepository } from '../repositories/roles/entity.provider.ts'
import { PasswordService } from './password.interactor.ts'
import {
  LOGIN_ACTIONS,
  type NOTIFIERS,
  resolveConfiguredAccessExpiration,
  resolveConfiguredRefreshExpiration,
  SERVICE_ID,
  TOKEN_EXPIRATION,
} from 'utils/constants.ts'
import { resolveEffectivePermissions as defaultResolveEffectivePermissions } from 'utils/rbac.ts'

/**
 * Business logic for the `auth` domain slice's own login/session/2FA-enrollment flows. Password
 * change/recovery lives in the sibling `PasswordService` — see that file's own header for why
 * they're split.
 *
 * Every path that verifies credentials/a refresh token and is about to issue tokens also gates on
 * `UsersRepository.assertActive(auth.userId)` — the `users` domain slice's own `status` — so a
 * deactivated/deleted profile can neither log in nor keep refreshing an existing session. A no-op
 * when `auth.userId` is unset, so this never breaks against an `auth` record with no linked
 * profile (see that method's own doc).
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
   * @param options.is2FA When set, this call originates from a 2FA challenge (a password/OAuth2
   *   login or a refresh whose account requires a second factor) rather than a direct OTP-login
   *   request — the response is then a generic dispatch confirmation.
   */
  public async loginWithOTP(
    email: string,
    options: { is2FA?: { notifier: typeof NOTIFIERS[number] } } = {},
  ) {
    const { is2FA } = options
    const response = await this.interactors.get(PasswordService).recovery(email, {
      isLogin: true,
      notifier: is2FA?.notifier,
    })

    if (!is2FA) return response
    return { message: 'Two-factor authentication is enabled. A verification code has been sent.' }
  }

  /**
   * Verifies the OTP `code` sent to `email` and, on success, issues session tokens — the same
   * configured `accessExpiration`/`refreshExpiration` as `finishLogin` (see its own doc for why).
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
   * @throws {HttpError} `FORBIDDEN` when no account exists for `email` and self-registration is
   *   disabled or `code` doesn't verify against the email-keyed target; when an account DOES
   *   exist, `FORBIDDEN` when `code` is invalid/expired (`ZanixAuthProvider.otp.authenticate`) or
   *   the linked `users` profile is deactivated/deleted (`UsersRepository.assertActive`).
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
      await this.providers.get(AuthRepository).registerAuth({ email, userId: profile.id })
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

    await this.providers.get(UsersRepository).assertActive(auth.userId)
    const permissions = await this.resolveSessionPermissions(auth.roleId)
    const tokens = await this.providers.get(ZanixAuthProvider).otp.authenticate(auth.id, code, {
      subject: auth.id,
      permissions,
      ...(accessExpiration !== undefined ? { accessExpiration } : {}),
      ...(refreshExpiration !== undefined ? { refreshExpiration } : {}),
    })
    await this.persistSession(auth.id)
    return { ...tokens, expiresAt: TOKEN_EXPIRATION }
  }

  /**
   * Begins TOTP enrollment for the current authenticated session: generates a new secret and its
   * provisioning URI, WITHOUT persisting anything yet — `totpConfirm` must verify the user's
   * authenticator app actually holds this secret before it's stored on the account.
   *
   * @throws {HttpError} `UNAUTHORIZED` when called with no authenticated session.
   */
  public totpEnroll() {
    const subject = this.context.session?.subject
    if (!subject) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })

    const totp = this.providers.get(ZanixAuthProvider).totp
    const secret = totp.generateSecret()
    const label =
      resolveBehavior<(email: string) => string>('auth', 'totpProvisioningLabel')?.(subject) ??
        subject
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
   * Verifies the authenticator-app `code` sent for `email`'s TOTP-secured login and, on success,
   * issues session tokens.
   *
   * @throws {HttpError} `FORBIDDEN` when the account has no TOTP secret enrolled, or `code`
   *   doesn't match.
   *
   * Issues the same configured `accessExpiration`/`refreshExpiration` as `finishLogin` (see its
   * own doc for why).
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
   * @throws {HttpError} `BAD_REQUEST` when this project isn't configured for `provider` (its
   *   `resources` slot never resolved — see `auth.app.ts`).
   */
  public loginWithOauth(provider: OauthProviders, state?: string) {
    const connector = this.getOauthConnector(provider)
    if (!connector) {
      throw new HttpError('BAD_REQUEST', {
        message: `OAuth2 provider "${provider}" is not configured.`,
      })
    }
    return connector.generateAuthUrl({ state })
  }

  /**
   * Completes an OAuth2 login for `provider`: exchanges the authorization `code` for the
   * provider's own user info (`validateCode` — the code-flow counterpart of a token-based
   * lookup, see `auth-oauth2`), then issues this project's own session tokens for the resolved
   * email, creating the `auth` record on first login.
   *
   * Takes no `state` parameter of its own: the callback's CSRF-protection round trip
   * (`login/[oauth]/callback/page.tsx`'s own `@zanix/auth`-provided `oauthStateVerifyGuard`)
   * already rejects a missing/mismatched `state` before this method's `loader` call site ever
   * runs — by the time `code` reaches here, the request is already known to be a genuine
   * continuation of a flow this project itself started, never a forged callback URL.
   *
   * @throws {HttpError} `BAD_REQUEST` when this project isn't configured for `provider`;
   *   `FORBIDDEN` when the provider returns no verified email, when no account exists for the
   *   resolved email and `selfRegistrationViaOAuth` is disabled, or when the linked `users`
   *   profile is deactivated/deleted; `CONFLICT` when the resolved email is already registered
   *   through a different sign-in method (password or another OAuth2 provider).
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
      // GitHub) isn't guaranteed enough to trust without per-provider parsing this project
      // doesn't do yet — left for the account's own owner to fill in via `PATCH /users`.
      const profile = await this.providers.get(UsersRepository).registerUser({})
      await this.providers.get(AuthRepository).registerAuth({
        email,
        oauthProvider: provider,
        userId: profile.id,
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
      // email, silently taking over their existing password-based account here). This project's
      // own reference precedent (`ms-iam`) does exactly this unchecked auto-link — a
      // real design weakness in that codebase, not something to carry over. An explicit
      // account-linking flow (gated behind an authenticated session) belongs to a later slice;
      // this foundation slice only ever creates a NEW account or logs into one already linked to
      // THIS SAME provider.
      throw new HttpError('CONFLICT', {
        message: 'An account already exists for this email with a different sign-in method.',
      })
    }
    await this.providers.get(UsersRepository).assertActive(auth.userId)

    return this.finishLogin(auth, 'login', { oauthProvider: provider })
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
   * `session.refreshTokens()` — which owns single-use rotation, reuse detection, and (since
   * `@zanix/auth@1.1.2`) a short rotation-grace window that tolerates two legitimate
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
   * validity (see `refreshTokens`'s own doc for why a separate, locally stored token hash was
   * removed).
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
   * repeated at each of those three call sites, for the identical reason.
   */
  private async finishLogin(
    auth: HydratedAuth,
    action: typeof LOGIN_ACTIONS[number],
    extra: Partial<AuthenticationAttrs> = {},
  ) {
    const sFA = auth.twoFactorAuthConfig
    if (sFA?.triggerOn.includes(action)) {
      if (sFA.method === 'totp') {
        return { message: 'Two-factor authentication is enabled. Enter your authenticator code.' }
      }
      return this.loginWithOTP(auth.email.unmask(), { is2FA: { notifier: sFA.method } })
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
   * `decodeRefreshSubject` — `@zanix/auth`'s `session.refreshTokens(token, sessionOptions)` now
   * accepts a `sessionOptions` override merged over the refresh token's own originally-embedded
   * `AuthSessionOptions`, which is what makes re-resolving permissions on refresh (not just at
   * login) actually take effect. A role/permission change therefore takes effect on the very next
   * refresh, not only the next full login — see `refreshTokens`'s own doc, and
   * `RolesService.assignRole`'s own doc for why this made a forced refresh-token revoke on
   * reassignment unnecessary.
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
