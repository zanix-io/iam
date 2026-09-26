import {
  Controller,
  Delete,
  Get,
  Guard,
  type HandlerContext,
  Post,
  ZanixController,
} from '@zanix/server'
import { AuthTokenValidation, CaptchaGuard, RateLimitGuard } from '@zanix/auth'
import {
  LoginOtpSearchRTO,
  LoginRTO,
  OAuthAuthorizeSearchRTO,
  OAuthLoginRTO,
  OAuthQueryRTO,
  OtpLoginRTO,
  ReactivationConfirmRTO,
  TokenRTO,
  TotpLoginRTO,
} from './rtos/login.ts'
import { AuthService } from '../interactors/auth.interactor.ts'
import {
  OtpNotifierRTO,
  PhoneConfirmRTO,
  PhoneEnrollRTO,
  PwdRecoveryRTO,
  TotpConfirmRTO,
} from './rtos/password.ts'
import { criticalRateLimit, freeRateLimit, loginMethodsRateLimit } from 'utils/constants.ts'
import { refreshRateLimitIdentityGuard } from 'utils/refresh-rate-limit-guard.ts'
import { phoneConfirmRateLimitIdentityGuard } from 'utils/phone-confirm-rate-limit-guard.ts'

/**
 * Login/session endpoints for the `auth` domain. Anonymous rate limiting on every route
 * below (`trustProxyHeader: true`) keys off the client IP resolved from proxy-forwarded headers
 * — this only produces a correct per-client limit when the request reaches this service through
 * a trusted reverse proxy; behind an untrusted or missing proxy that header can be spoofed, so no
 * proxy in front of this service must ever be treated as trusted by default.
 *
 * **Every anonymous `@RateLimitGuard` below carries its own `app` value.** `rateLimitGuard`'s
 * cache key has no route component of its own (`${app ? \`${app}-${sessionId}\` : sessionId}\`,
 * `@zanix/auth`'s own `rateLimitGuard`) — without `app`, every anonymous route on this controller
 * would share ONE counter per client identity, so one route's calls could exhaust another route's
 * unrelated budget. Every new anonymous route here needs its own `app` value too.
 *
 * `loginMethods` also has its own limit tier, {@linkcode loginMethodsRateLimit} — see that
 * constant's own doc.
 */
@Controller({ prefix: 'login', Interactor: AuthService })
export class LoginController extends ZanixController<AuthService> {
  /**
   * Authenticates with `email`/`password` and issues session tokens, or an OTP/TOTP challenge
   * confirmation when the account has 2FA configured to trigger on login.
   */
  @Post({ Body: LoginRTO })
  @RateLimitGuard({ app: 'login:password', anonymousLimit: freeRateLimit, trustProxyHeader: true })
  @CaptchaGuard()
  public login(ctx: HandlerContext<{ body: LoginRTO }>) {
    const { email, password } = ctx.payload.body
    return this.interactor.loginWithPassword(email, password)
  }

  /** Requests an OTP login code for `:email` — delivered out of band, complete via
   * `loginOtpCallback`. `?notifier=` (optional, see `LoginOtpSearchRTO`'s own doc) overrides the
   * account's own stored preference for this one dispatch only. */
  @Get('otp/:email', { Params: PwdRecoveryRTO, Search: LoginOtpSearchRTO })
  @RateLimitGuard({ app: 'login:otp', anonymousLimit: criticalRateLimit, trustProxyHeader: true })
  public loginOtp(
    ctx: HandlerContext<{ params: PwdRecoveryRTO; search: LoginOtpSearchRTO }>,
  ) {
    return this.interactor.loginWithOTP(ctx.payload.params.email, {
      notifier: ctx.payload.search.notifier,
    })
  }

  /** Verifies an OTP `code` sent to `email` and, on success, issues session tokens. */
  @Post('otp/callback', { Body: OtpLoginRTO })
  @RateLimitGuard({
    app: 'login:otp-callback',
    anonymousLimit: freeRateLimit,
    trustProxyHeader: true,
  })
  public loginOtpCallback(ctx: HandlerContext<{ body: OtpLoginRTO }>) {
    const { email, code } = ctx.payload.body
    return this.interactor.loginWithOTPCallback(email, code)
  }

  /**
   * Completes the reactivation an OTP/OAuth callback deferred: exchanges the short-lived
   * `reactivationToken` `loginOtpCallback`/`oAuthLogin` returned instead of tokens (see
   * `AuthService.challengeReactivation`'s own doc) for a real, finished session — reactivating the
   * linked `'INACTIVE'` profile only once the caller has actually confirmed it here.
   */
  @Post('reactivate', { Body: ReactivationConfirmRTO })
  @RateLimitGuard({
    app: 'login:reactivate',
    anonymousLimit: freeRateLimit,
    trustProxyHeader: true,
  })
  public confirmReactivation(ctx: HandlerContext<{ body: ReactivationConfirmRTO }>) {
    return this.interactor.confirmReactivation(ctx.payload.body.reactivationToken)
  }

  /** Verifies a TOTP `code` for an authenticator-app-secured account and issues session tokens. */
  @Post('totp/callback', { Body: TotpLoginRTO })
  @RateLimitGuard({
    app: 'login:totp-callback',
    anonymousLimit: freeRateLimit,
    trustProxyHeader: true,
  })
  public loginTotpCallback(ctx: HandlerContext<{ body: TotpLoginRTO }>) {
    const { email, code } = ctx.payload.body
    return this.interactor.loginWithTOTPCallback(email, code)
  }

  /** Starts the OAuth2 flow for `:oauth` (e.g. `google`) and returns the provider's authorization
   * URL — `?email=` (optional, see `OAuthAuthorizeSearchRTO`'s own doc) pre-fills/pre-selects that
   * account on the provider's own chooser screen. */
  @Get(':oauth', { Params: OAuthQueryRTO, Search: OAuthAuthorizeSearchRTO })
  @RateLimitGuard({ app: 'login:oauth', anonymousLimit: criticalRateLimit, trustProxyHeader: true })
  public oAuth(
    ctx: HandlerContext<{ params: OAuthQueryRTO; search: OAuthAuthorizeSearchRTO }>,
  ) {
    return this.interactor.loginWithOauth(
      ctx.payload.params.oauth,
      undefined,
      ctx.payload.search.email,
    )
  }

  /**
   * Completes the OAuth2 flow for `:oauth`: `code` is the authorization code from the provider's
   * own redirect — this project's connectors are code-flow-only (`responseType: 'code'`, see
   * `auth.app.ts`), never a client-obtained bearer token.
   */
  @Post(':oauth/callback', { Params: OAuthQueryRTO, Body: OAuthLoginRTO })
  @RateLimitGuard({
    app: 'login:oauth-callback',
    anonymousLimit: freeRateLimit,
    trustProxyHeader: true,
  })
  public oAuthLogin(ctx: HandlerContext<{ body: OAuthLoginRTO; params: OAuthQueryRTO }>) {
    const { code } = ctx.payload.body
    const { oauth } = ctx.payload.params
    return this.interactor.loginWithOauthCallback(code, oauth)
  }

  /**
   * Completes an OAuth2 CONNECT flow for `:oauth` against the caller's OWN already-authenticated
   * account — never a login, never account creation (see `AuthService.linkOauth`'s own doc).
   * Requires a valid access token; the target account is the session's own subject.
   */
  @Post(':oauth/link', { Params: OAuthQueryRTO, Body: OAuthLoginRTO })
  @AuthTokenValidation()
  public oAuthLink(ctx: HandlerContext<{ body: OAuthLoginRTO; params: OAuthQueryRTO }>) {
    const { code } = ctx.payload.body
    const { oauth } = ctx.payload.params
    return this.interactor.linkOauth(code, oauth)
  }

  /**
   * Disconnects `:oauth` from the caller's own account. Requires a valid access token.
   */
  @Delete(':oauth', { Params: OAuthQueryRTO })
  @AuthTokenValidation()
  public oAuthUnlink(ctx: HandlerContext<{ params: OAuthQueryRTO }>) {
    return this.interactor.unlinkOauth(ctx.payload.params.oauth)
  }

  /**
   * Returns a plain, sanitized summary of the caller's own sign-in methods — see
   * `AuthService.getOwnAuthMethods`'s own doc. Requires a valid access token.
   */
  @Get('methods')
  @AuthTokenValidation()
  public methods(_ctx: HandlerContext) {
    return this.interactor.getOwnAuthMethods()
  }

  /**
   * Identifies which login method(s) `:email` has configured — step 1 of a two-step login flow
   * (collect the email first, then show the right next step: a password field when one is set, or
   * the existing OTP flow otherwise, the same shape GitHub/many modern apps use). Public — no
   * access token, unlike `methods` above (that one is the self-scoped, already-authenticated
   * equivalent of this same summary).
   *
   * **Public and unauthenticated by design, so treat every change here as a security-sensitive
   * one**: see `AuthService.resolveLoginMethods`'s own doc for the full email-enumeration
   * rationale — this endpoint's response is deliberately IDENTICAL for a nonexistent email and an
   * existing one with no password/OAuth2 method configured, and `RateLimitGuard` below is the
   * other half of that defense (a uniform response alone doesn't stop a caller from brute-forcing
   * many candidate emails one at a time). Never loosen either without re-reading that doc.
   *
   * Rate-limited by {@linkcode loginMethodsRateLimit}, not `criticalRateLimit` — see that constant's
   * own doc.
   */
  @Get('methods/:email', { Params: PwdRecoveryRTO })
  @RateLimitGuard(
    { app: 'login:methods', anonymousLimit: loginMethodsRateLimit, trustProxyHeader: true },
  )
  public loginMethods(ctx: HandlerContext<{ params: PwdRecoveryRTO }>) {
    return this.interactor.resolveLoginMethods(ctx.payload.params.email)
  }

  /**
   * Exchanges a refresh `token` for a new session token pair. Rate-limited per-identity, not just
   * per-IP, when the token also reaches this endpoint via the `X-Znx-App-Token` header/cookie —
   * see `refreshRateLimitIdentityGuard`'s own doc for why that's needed on top of
   * `@RateLimitGuard` alone.
   *
   * **Decorator order here is load-bearing, not stylistic**: `@zanix/server`'s stacked method
   * decorators apply BOTTOM-UP (the decorator closest to the method registers, and therefore
   * RUNS, first) — the opposite of top-to-bottom reading order. `refreshRateLimitIdentityGuard`
   * is written closer to the method (below `@RateLimitGuard`) specifically so it runs FIRST,
   * populating `ctx.locals.session` before `@RateLimitGuard` reads it. Writing them in "reading"
   * order (identity guard on top) would silently run `@RateLimitGuard` first every time, making
   * this guard a no-op.
   */
  @Post('refresh', { Body: TokenRTO })
  @RateLimitGuard({
    app: 'login:refresh',
    anonymousLimit: criticalRateLimit,
    trustProxyHeader: true,
  })
  @Guard(refreshRateLimitIdentityGuard())
  public refresh(ctx: HandlerContext<{ body: TokenRTO }>) {
    return this.interactor.refreshTokens(ctx.payload.body.token)
  }

  /** Revokes the given refresh `token`, ending the current session. Requires a valid access token. */
  @Post({ Body: TokenRTO })
  @AuthTokenValidation()
  public logout(ctx: HandlerContext<{ body: TokenRTO }>) {
    return this.interactor.revokeToken(ctx.payload.body.token)
  }

  /**
   * Begins TOTP (authenticator-app) enrollment for the caller's own account — returns a secret
   * and its QR-provisioning URI, not yet persisted. Requires a valid access token; confirm with
   * `totpConfirm` before the secret is actually stored.
   */
  @Get('totp/enroll')
  @AuthTokenValidation()
  public totpEnroll(_ctx: HandlerContext) {
    return this.interactor.totpEnroll()
  }

  /**
   * Confirms a TOTP enrollment by verifying `code` against the just-generated `secret`, then
   * persists it and enables TOTP as the account's 2FA method on login. Requires a valid access
   * token.
   */
  @Post('totp/confirm', { Body: TotpConfirmRTO })
  @AuthTokenValidation()
  public totpConfirm(ctx: HandlerContext<{ body: TotpConfirmRTO }>) {
    const { secret, code } = ctx.payload.body
    return this.interactor.totpConfirm(secret, code)
  }

  /**
   * Disables TOTP 2FA for the caller's own account. Requires a valid access token.
   */
  @Delete('totp')
  @AuthTokenValidation()
  public totpDisable(_ctx: HandlerContext) {
    return this.interactor.disableTotp()
  }

  /**
   * Begins phone verification for the caller's own account — sends a one-time SMS code to `phone`,
   * not yet persisted. Requires a valid access token; confirm with `phoneConfirm` before the
   * number is actually stored.
   */
  @Post('phone/enroll', { Body: PhoneEnrollRTO })
  @AuthTokenValidation()
  public phoneEnroll(ctx: HandlerContext<{ body: PhoneEnrollRTO }>) {
    return this.interactor.phoneEnroll(ctx.payload.body.phone)
  }

  /**
   * Confirms phone verification by checking `code` against the just-dispatched SMS code, then
   * persists `phone` on the caller's own account. Requires a valid access token.
   *
   * Same `freeRateLimit` (3 attempts) `login:otp-callback` uses for the equivalent "brute-force a
   * short numeric code" surface — a wrong guess here is exactly as cheap to retry as a wrong
   * login OTP, so it gets the same ceiling. `@RateLimitGuard`'s own `anonymousLimit` alone can't
   * enforce that ceiling on an authenticated route — see `phoneConfirmRateLimitIdentityGuard`'s
   * own doc. Decorators apply bottom-up (see `refresh` above): `@AuthTokenValidation()` runs first (authenticates, populates the token-derived
   * session), then `phoneConfirmRateLimitIdentityGuard` (overwrites `rateLimit` with THIS route's
   * own 3), then `@RateLimitGuard` (finally reads that 3, not the token's own value).
   */
  @Post('phone/confirm', { Body: PhoneConfirmRTO })
  @RateLimitGuard({ app: 'phone:confirm', anonymousLimit: freeRateLimit, trustProxyHeader: true })
  @Guard(phoneConfirmRateLimitIdentityGuard())
  @AuthTokenValidation()
  public phoneConfirm(ctx: HandlerContext<{ body: PhoneConfirmRTO }>) {
    const { phone, code } = ctx.payload.body
    return this.interactor.phoneConfirm(phone, code)
  }

  /**
   * Forgets the caller's own verified phone (and any `'sms'`/`'whatsapp'` login-OTP preference
   * that depended on it). Requires a valid access token.
   */
  @Delete('phone')
  @AuthTokenValidation()
  public phoneDisable(_ctx: HandlerContext) {
    return this.interactor.disablePhone()
  }

  /**
   * Sets (or, `notifier` omitted, clears back to `'email'`) which channel the caller's own
   * passwordless login-OTP code is delivered through. Requires a valid access token.
   */
  @Post('otp-notifier', { Body: OtpNotifierRTO })
  @AuthTokenValidation()
  public setOtpNotifier(ctx: HandlerContext<{ body: OtpNotifierRTO }>) {
    return this.interactor.setOtpNotifier(ctx.payload.body.notifier)
  }
}
