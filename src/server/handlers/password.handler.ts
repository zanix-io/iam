import { Controller, Get, type HandlerContext, Post, ZanixController } from '@zanix/server'
import { AuthTokenValidation, CaptchaGuard, RateLimitGuard } from '@zanix/auth'
import { PwdRecoveryCbRTO, PwdRecoveryRTO, PwdRTO } from './rtos/password.ts'
import { PasswordService } from '../interactors/password.interactor.ts'
import { criticRateLimit, freeRateLimit } from 'utils/constants.ts'

/**
 * Self-service password + TOTP-enrollment endpoints. Anonymous rate limiting on the recovery
 * routes carries the same `trustProxyHeader: true` caveat as `LoginController` — see that file's
 * own header doc.
 */
@Controller({ prefix: 'pwd', Interactor: PasswordService })
export class PasswordController extends ZanixController<PasswordService> {
  /**
   * Changes the caller's own password after verifying `currentPassword`. Requires a valid access
   * token; the target account is the authenticated session's own subject, never a body/param.
   */
  @Post({ Body: PwdRTO })
  @AuthTokenValidation()
  public change(ctx: HandlerContext<{ body: PwdRTO }>) {
    const { currentPassword, newPassword } = ctx.payload.body
    return this.interactor.changePwd(currentPassword, newPassword)
  }

  /**
   * Requests a password-recovery code for `:email`, delivered out of band. Complete with
   * `recoveryCallback`.
   */
  @Get('recovery/:email', { Params: PwdRecoveryRTO })
  @RateLimitGuard({ anonymousLimit: criticRateLimit, trustProxyHeader: true })
  @CaptchaGuard()
  public recovery(ctx: HandlerContext<{ params: PwdRecoveryRTO }>) {
    return this.interactor.recovery(ctx.payload.params.email)
  }

  /** Verifies the recovery `code` sent to `email` and sets `password`, issuing session tokens. */
  @Post('recovery/callback', { Body: PwdRecoveryCbRTO })
  @RateLimitGuard({ anonymousLimit: freeRateLimit, trustProxyHeader: true })
  public recoveryCallback(ctx: HandlerContext<{ body: PwdRecoveryCbRTO }>) {
    const { password, code, email } = ctx.payload.body
    return this.interactor.recoveryCallback(email, code, password)
  }
}
