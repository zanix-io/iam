import type { PageContext } from '@zanix/space'

import { Guard } from '@zanix/server'
import { Page, SpacePageController } from '@zanix/space'
import { rateLimitGuard } from '@zanix/auth'
import { RecoveryRequestView } from 'ui/pages/password-recovery-request/index.ts'
import type { RecoveryRequestViewProps } from 'ui/pages/password-recovery-request/index.ts'
import { PasswordService } from 'server/interactors/password.interactor.ts'
import { criticalRateLimit } from 'utils/constants.ts'

type RecoveryParams = { lang: string; email: string }

/** See `../../../login/otp/[email]/page.tsx`'s identical helper — same reasoning. */
function decodeEmailParam(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * The password-recovery REQUEST step — dispatches a recovery code for `:email` on `GET`, the same
 * project convention `PasswordController.recovery` (the matching REST endpoint) already treats as
 * an anonymous-rate-limited `GET` side effect (`RateLimitGuard({ anonymousLimit: criticalRateLimit,
 * ... })`), rather than something requiring a `POST`. `../callback/page.tsx` is the separate
 * confirmation-form step (code + new password) — split the same way the two REST endpoints
 * (`recovery` / `recoveryCallback`) are.
 *
 * `PasswordService.recovery` answers the same confirmation for every email (see its doc), so this
 * page renders the same view whether or not an account exists.
 */
// This page's own `loader` calls `PasswordService.recovery` directly (an
// in-process interactor call, fired on a plain `GET`), so `PasswordController.recovery`'s own
// `@RateLimitGuard` (`password.handler.ts`) never runs for a visitor reaching this route. A
// distinct `app` key (`pwd:recovery-page`) keeps its own bucket, isolated from the REST endpoint's
// own.
@Page({ Interactor: PasswordService })
@Guard(
  rateLimitGuard({
    app: 'pwd:recovery-page',
    anonymousLimit: criticalRateLimit,
    trustProxyHeader: true,
  }),
)
export default class PasswordRecoveryRequestPage
  extends SpacePageController<RecoveryParams, PasswordService> {
  public static override head = { title: 'Check your email' }

  public override component = RecoveryRequestView

  public override loader = async (
    ctx: PageContext<RecoveryParams>,
  ): Promise<RecoveryRequestViewProps> => {
    const email = decodeEmailParam(ctx.params.email)
    await this.interactor.recovery(email)
    return { lang: ctx.params.lang, email }
  }
}
