import type { PageActionContext, PageContext } from '@zanix/space'

import { Guard } from '@zanix/server'
import { csrfGuard, Page, SpacePageController } from '@zanix/space'
import { HttpError } from '@zanix/errors'
import { rateLimitGuard } from '@zanix/auth'
import { ReactivateConfirmView } from 'ui/pages/login-reactivate-confirm/index.ts'
import { AuthService } from 'server/interactors/auth.interactor.ts'
import { redirectResponse } from 'shared/redirect-response.ts'
import { freeRateLimit, resolvePostLoginRedirect } from 'utils/constants.ts'

type ReactivateParams = { lang: string; token: string }

/** Query param this page's own `action` redirects back with on an invalid/expired token. */
const EXPIRED_ERROR = 'expired'

/**
 * The reactivation-confirmation interstitial: `AuthService.loginWithOTPCallback`'s
 * existing-account branch and `AuthService.loginWithOauthCallback` both return
 * `{ needsReactivationConfirm: true, reactivationToken }` instead of finishing login once identity
 * verification succeeds against an `'INACTIVE'` account (see `challengeReactivation`'s own doc,
 * `server/interactors/auth.interactor.ts`) — `../../otp/[email]/page.tsx`'s own `action` and
 * `../../[oauth]/callback/page.tsx`'s own `loader` both redirect here with that token instead of
 * completing the sign-in. Only THIS page's own confirm submit actually reactivates the account,
 * via `AuthService.confirmReactivation` — the "cancel"/back-to-sign-in link never calls it, so
 * nothing changes if the caller backs out.
 *
 * `ctx.params.token` is the exact `reactivationToken` value, never URL-decoded — a JWT's own
 * base64url alphabet (`[A-Za-z0-9_-]` plus `.` separators) needs no percent-encoding, unlike
 * `[email]`'s own sibling routes.
 *
 * Renders this package's own `ui/pages/login-reactivate-confirm` view (`createElement`-based,
 * never JSX).
 */
// Own rate-limit bucket, isolated from every other login route's own — an in-process
// `AuthService` call never runs `LoginController`'s own `@RateLimitGuard`.
@Page({ Interactor: AuthService })
@Guard(csrfGuard())
@Guard(
  rateLimitGuard(
    { app: 'login:reactivate-page', anonymousLimit: freeRateLimit, trustProxyHeader: true },
  ),
)
export default class LoginReactivatePage
  extends SpacePageController<ReactivateParams, AuthService> {
  public static override head = { title: 'Reactivate your account' }

  public override component = ReactivateConfirmView

  public override loader = (ctx: PageContext<ReactivateParams>) => ({
    lang: ctx.params.lang,
    csrfToken: ctx.csrfToken,
    expired: ctx.url.searchParams.get('error') === EXPIRED_ERROR,
  })

  public override action = async (ctx: PageActionContext<ReactivateParams>): Promise<Response> => {
    const { lang, token } = ctx.params

    try {
      await this.interactor.confirmReactivation(token)
    } catch (e) {
      if (e instanceof HttpError && e.status.code === 'FORBIDDEN') {
        return redirectResponse(`/${lang}/login/reactivate/${token}?error=${EXPIRED_ERROR}`)
      }
      throw e
    }

    return redirectResponse(resolvePostLoginRedirect(ctx.url))
  }
}
