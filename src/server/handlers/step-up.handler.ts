import { Controller, Guard, type HandlerContext, Post, ZanixController } from '@zanix/server'
import { AuthTokenValidation, RateLimitGuard } from '@zanix/auth'
import { StepUpRequestRTO, StepUpVerifyRTO } from './rtos/step-up.ts'
import { StepUpService } from '../interactors/step-up.interactor.ts'
import { criticalRateLimit, freeRateLimit } from 'utils/constants.ts'
import { messageLangGuard } from 'utils/message-lang.ts'

/**
 * Second-factor re-verification of a signed-in user, ahead of a sensitive action. Both routes
 * require a valid access token and act on its subject only.
 *
 * Each route caps the caller at its own fixed `limit` per user (`key: 'subject'`), not at the
 * account-tier limit the access token carries: `request` at {@linkcode criticalRateLimit} because
 * it can send a message, `verify` at {@linkcode freeRateLimit} because every wrong guess at a short
 * code counts. `anonymousLimit: false` because a token is always required. Decorators apply
 * bottom-up, so `@AuthTokenValidation()` runs first and the session exists when the rate limit
 * reads it.
 */
@Controller({ prefix: 'step-up', Interactor: StepUpService })
export class StepUpController extends ZanixController<StepUpService> {
  /**
   * Starts a step-up for `purpose`: answers which factor the user's own settings require (`totp`,
   * or a one-time code just sent through their notifier).
   */
  @Post('request', { Body: StepUpRequestRTO })
  @Guard(messageLangGuard())
  @RateLimitGuard({
    app: 'step-up:request',
    limit: criticalRateLimit,
    key: 'subject',
    anonymousLimit: false,
  })
  @AuthTokenValidation()
  public request(ctx: HandlerContext<{ body: StepUpRequestRTO }>) {
    return this.interactor.request(ctx.payload.body.purpose)
  }

  /**
   * Verifies the second-factor `code` and answers a short-lived step-up token for `purpose`
   * (and `bind`, when given).
   */
  @Post('verify', { Body: StepUpVerifyRTO })
  @RateLimitGuard({
    app: 'step-up:verify',
    limit: freeRateLimit,
    key: 'subject',
    anonymousLimit: false,
  })
  @AuthTokenValidation()
  public verify(ctx: HandlerContext<{ body: StepUpVerifyRTO }>) {
    const { purpose, code, bind } = ctx.payload.body
    return this.interactor.verify(purpose, code, bind)
  }
}
