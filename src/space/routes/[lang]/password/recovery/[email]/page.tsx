import type { PageContext } from '@zanix/space'

import { Page, SpacePageController } from '@zanix/space'
import { PasswordService } from '../../../../../../server/interactors/password.interactor.ts'

type RecoveryParams = { lang: string; email: string }

type RecoveryViewProps = { lang: string; email: string }

/** See `../../../login/otp/[email]/page.tsx`'s identical helper — same reasoning. */
function decodeEmailParam(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function RecoveryRequestView({ lang, email }: RecoveryViewProps) {
  return (
    <main>
      <h1>Check your email</h1>
      <p>If an account exists for {email}, a recovery code has been sent.</p>
      <p>
        <a href={`/${lang}/password/recovery/callback?email=${encodeURIComponent(email)}`}>
          I have my code
        </a>
      </p>
    </main>
  )
}

/**
 * The password-recovery REQUEST step — dispatches a recovery code for `:email` on `GET`, the same
 * project convention `PasswordController.recovery` (the matching REST endpoint) already treats as
 * an anonymous-rate-limited `GET` side effect (`RateLimitGuard({ anonymousLimit: criticRateLimit,
 * ... })`), rather than something requiring a `POST`. `../callback/page.tsx` is the separate
 * confirmation-form step (code + new password) — split the same way the task's own two REST
 * endpoints (`recovery` / `recoveryCallback`) already are.
 *
 * `PasswordService.recovery` throws `FORBIDDEN` for an email with no account — left to propagate
 * to this route's own error boundary/default error view rather than silently swallowed, matching
 * this project's existing, already-tested interactor behavior as-is (an email-enumeration hardening
 * choice, if wanted, belongs to `PasswordService` itself, not something this page should
 * reinterpret on its own).
 */
@Page({ Interactor: PasswordService })
export default class PasswordRecoveryRequestPage
  extends SpacePageController<RecoveryParams, PasswordService> {
  public static override head = { title: 'Check your email' }

  public override component = RecoveryRequestView

  public override loader = async (ctx: PageContext<RecoveryParams>): Promise<RecoveryViewProps> => {
    const email = decodeEmailParam(ctx.params.email)
    await this.interactor.recovery(email)
    return { lang: ctx.params.lang, email }
  }
}
