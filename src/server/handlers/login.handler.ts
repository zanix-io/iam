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
  LoginRTO,
  OAuthLoginRTO,
  OAuthQueryRTO,
  OtpLoginRTO,
  TokenRTO,
  TotpLoginRTO,
} from './rtos/login.ts'
import { AuthService } from '../interactors/auth.interactor.ts'
import { PwdRecoveryRTO, TotpConfirmRTO } from './rtos/password.ts'
import { criticRateLimit, freeRateLimit } from 'utils/constants.ts'
import { refreshRateLimitIdentityGuard } from 'utils/refresh-rate-limit-guard.ts'

/**
 * Login/session endpoints for the `auth` domain slice. Anonymous rate limiting on every route
 * below (`trustProxyHeader: true`) keys off the client IP resolved from proxy-forwarded headers
 * — this only produces a correct per-client limit when the request reaches this service through
 * a trusted reverse proxy; behind an untrusted or missing proxy that header can be spoofed, so no
 * proxy in front of this service must ever be treated as trusted by default.
 */
@Controller({ prefix: 'login', Interactor: AuthService })
export class LoginController extends ZanixController<AuthService> {
  /**
   * Authenticates with `email`/`password` and issues session tokens, or an OTP/TOTP challenge
   * confirmation when the account has 2FA configured to trigger on login.
   */
  @Post({ Body: LoginRTO })
  @RateLimitGuard({ anonymousLimit: freeRateLimit, trustProxyHeader: true })
  @CaptchaGuard()
  public login(ctx: HandlerContext<{ body: LoginRTO }>) {
    const { email, password } = ctx.payload.body
    return this.interactor.loginWithPassword(email, password)
  }

  /** Requests an OTP login code for `:email` — delivered out of band, complete via `loginOtpCallback`. */
  @Get('otp/:email', { Params: PwdRecoveryRTO })
  @RateLimitGuard({ anonymousLimit: criticRateLimit, trustProxyHeader: true })
  public loginOtp(ctx: HandlerContext<{ params: PwdRecoveryRTO }>) {
    return this.interactor.loginWithOTP(ctx.payload.params.email)
  }

  /** Verifies an OTP `code` sent to `email` and, on success, issues session tokens. */
  @Post('otp/callback', { Body: OtpLoginRTO })
  @RateLimitGuard({ anonymousLimit: freeRateLimit, trustProxyHeader: true })
  public loginOtpCallback(ctx: HandlerContext<{ body: OtpLoginRTO }>) {
    const { email, code } = ctx.payload.body
    return this.interactor.loginWithOTPCallback(email, code)
  }

  /** Verifies a TOTP `code` for an authenticator-app-secured account and issues session tokens. */
  @Post('totp/callback', { Body: TotpLoginRTO })
  @RateLimitGuard({ anonymousLimit: freeRateLimit, trustProxyHeader: true })
  public loginTotpCallback(ctx: HandlerContext<{ body: TotpLoginRTO }>) {
    const { email, code } = ctx.payload.body
    return this.interactor.loginWithTOTPCallback(email, code)
  }

  /** Starts the OAuth2 flow for `:oauth` (e.g. `google`) and returns the provider's authorization URL. */
  @Get(':oauth', { Params: OAuthQueryRTO })
  @RateLimitGuard({ anonymousLimit: criticRateLimit, trustProxyHeader: true })
  public oAuth(ctx: HandlerContext<{ params: OAuthQueryRTO }>) {
    return this.interactor.loginWithOauth(ctx.payload.params.oauth)
  }

  /**
   * Completes the OAuth2 flow for `:oauth`: `code` is the authorization code from the provider's
   * own redirect — this project's connectors are code-flow-only (see `auth-oauth2`), never a
   * client-obtained bearer token.
   */
  @Post(':oauth/callback', { Params: OAuthQueryRTO, Body: OAuthLoginRTO })
  @RateLimitGuard({ anonymousLimit: freeRateLimit, trustProxyHeader: true })
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
   * Exchanges a refresh `token` for a new session token pair. Rate-limited per-identity, not just
   * per-IP, when the token also reaches this endpoint via the `X-Znx-App-Token` header/cookie —
   * see `refreshRateLimitIdentityGuard`'s own doc for why that's needed on top of
   * `@RateLimitGuard` alone.
   *
   * **Decorator order here is load-bearing, not stylistic**: `@zanix/server`'s stacked method
   * decorators apply BOTTOM-UP (confirmed via a real, isolated repro against
   * `defineMiddlewareDecorator` — the decorator closest to the method registers, and therefore
   * RUNS, first) — the exact opposite of top-to-bottom reading order. `refreshRateLimitIdentityGuard`
   * is written closer to the method (below `@RateLimitGuard`) specifically so it runs FIRST,
   * populating `ctx.locals.session` before `@RateLimitGuard` reads it. Writing them in "reading"
   * order (identity guard on top) would silently run `@RateLimitGuard` first every time, making
   * this guard a no-op — confirmed as a real regression, not a hypothetical.
   */
  @Post('refresh', { Body: TokenRTO })
  @RateLimitGuard({ anonymousLimit: criticRateLimit, trustProxyHeader: true })
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
}
