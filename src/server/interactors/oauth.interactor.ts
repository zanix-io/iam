import type { HydratedAuth } from '../repositories/auth/model.defs.ts'
import type { GitHubOAuth2Connector, GoogleOAuth2Connector } from '@zanix/auth'
import { Interactor, ZanixInteractor } from '@zanix/server'
import { contextMessageLang } from 'utils/message-lang.ts'
import { HttpError } from '@zanix/errors'
import { NotifierProvider } from '@zanix/notifications'
import { resolveConfig, resolveResource } from '@zanix/app/runtime'
import { AuthRepository } from '../repositories/auth/entity.provider.ts'
import { UsersRepository } from '../repositories/users/entity.provider.ts'
import type { NOTIFIERS } from 'utils/constants.ts'
import { recordEmailProof } from './email-proof.ts'
import { SessionService } from './session.interactor.ts'

/**
 * OAuth2 sign-in and linking: the redirect, the callback, which methods an account has, and
 * linking or unlinking a provider.
 */
@Interactor()
export class OauthService extends ZanixInteractor {
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
    // Only a provider that reports the address as verified proves the mailbox: Google's user info
    // carries `verified_email`, GitHub's carries no flag at all and never counts.
    const emailVerified = user.verified_email === true

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
      const defaultRole = resolveConfig<string>('auth', 'defaultRoleId') || undefined
      await this.providers.get(AuthRepository).registerAuth({
        email,
        oauthProvider: provider,
        userId: profile.id,
        roleIds: defaultRole ? [defaultRole] : undefined,
        ...(emailVerified ? { emailVerifiedAt: new Date() } : {}),
      })
      // Re-fetched (rather than trusting the just-created document directly) so `auth` goes
      // through the exact same hydration/data-policy path `findByEmail` already gives every
      // other caller — no second, parallel way to shape a `HydratedAuth`.
      auth = await this.providers.get(AuthRepository).findByEmail(email) as unknown as HydratedAuth
      await this.providers.get(NotifierProvider).email({
        to: email,
        zanixTemplate: 'welcome',
        lang: contextMessageLang(this.context),
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
        return this.interactors.get(SessionService).challengeReactivation(auth.id)
      }
    }

    // A new account was created with the proof already recorded.
    if (emailVerified && !auth.emailVerifiedAt) await recordEmailProof(this.providers, auth.id)
    return this.interactors.get(SessionService).finishLogin(
      auth,
      'login',
      { oauthProvider: provider },
      emailVerified || Boolean(auth.emailVerifiedAt),
    )
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
    const totpEnabled = auth.twoFactorAuthConfig?.method === 'totp'

    return {
      email: auth.email.unmask(),
      hasPassword: Boolean(auth.password),
      oauthProvider: auth.oauthProvider ?? null,
      totpEnabled,
      // Only how many are left, never the codes.
      backupCodesRemaining: totpEnabled
        ? await this.providers.get(AuthRepository).countBackupCodes(authId)
        : 0,
      emailVerified: Boolean(auth.emailVerifiedAt),
      ...(auth.emailVerifiedAt ? { emailVerifiedAt: auth.emailVerifiedAt.toISOString() } : {}),
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
    // The provider reports this exact address as verified, so linking also proves the mailbox.
    if (user.verified_email === true && !auth.emailVerifiedAt) {
      await recordEmailProof(this.providers, authId)
    }
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
