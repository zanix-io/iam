import { Controller, Delete, Get, type HandlerContext, Post, ZanixController } from '@zanix/server'
import { AuthTokenValidation, CaptchaGuard, RateLimitGuard } from '@zanix/auth'
import { AddPasswordRTO, PwdRecoveryCbRTO, PwdRecoveryRTO, PwdRTO } from './rtos/password.ts'
import { PasswordService } from '../interactors/password.interactor.ts'
import { criticalRateLimit, freeRateLimit } from 'utils/constants.ts'

/**
 * Self-service password endpoints — change/add/remove and recovery. Anonymous rate limiting on the
 * recovery routes carries the same `trustProxyHeader: true` caveat as `LoginController` — see that
 * file's own header doc, including why each route below carries its own `app` value.
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
   * Sets a first password for the caller's own account — only when it doesn't already have one
   * (see `PasswordService.addPassword`'s own doc). Requires a valid access token.
   */
  @Post('add', { Body: AddPasswordRTO })
  @AuthTokenValidation()
  public add(ctx: HandlerContext<{ body: AddPasswordRTO }>) {
    return this.interactor.addPassword(ctx.payload.body.newPassword)
  }

  /** Removes the caller's own password entirely. Requires a valid access token. */
  @Delete('remove')
  @AuthTokenValidation()
  public remove(_ctx: HandlerContext) {
    return this.interactor.removePassword()
  }

  /**
   * Requests a password-recovery code for `:email`, delivered out of band. Complete with
   * `recoveryCallback`.
   */
  @Get('recovery/:email', { Params: PwdRecoveryRTO })
  @RateLimitGuard({
    app: 'pwd:recovery',
    anonymousLimit: criticalRateLimit,
    trustProxyHeader: true,
  })
  @CaptchaGuard()
  public recovery(ctx: HandlerContext<{ params: PwdRecoveryRTO }>) {
    return this.interactor.recovery(ctx.payload.params.email)
  }

  /** Verifies the recovery `code` sent to `email` and sets `password`, issuing session tokens. */
  @Post('recovery/callback', { Body: PwdRecoveryCbRTO })
  @RateLimitGuard({
    app: 'pwd:recovery-callback',
    anonymousLimit: freeRateLimit,
    trustProxyHeader: true,
  })
  public recoveryCallback(ctx: HandlerContext<{ body: PwdRecoveryCbRTO }>) {
    const { password, code, email } = ctx.payload.body
    return this.interactor.recoveryCallback(email, code, password)
  }
}
