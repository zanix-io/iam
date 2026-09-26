import type { PageActionContext, PageContext } from '@zanix/space'

import { Guard } from '@zanix/server'
import { csrfGuard, Page, SpacePageController } from '@zanix/space'
import { HttpError } from '@zanix/errors'
import { rateLimitGuard } from '@zanix/auth'
import { TotpLoginView } from 'ui/pages/login-totp/index.ts'
import { AuthService } from 'server/interactors/auth.interactor.ts'
import { TotpLoginRTO } from 'server/handlers/rtos/login.ts'
import { redirectResponse } from 'shared/redirect-response.ts'
import { freeRateLimit, resolvePostLoginRedirect } from 'utils/constants.ts'

type TotpParams = { lang: string; email: string }

/** Query param this page's own `action` redirects back with on a rejected code. */
const INVALID_CODE_ERROR = 'invalid_code'

/** See `login/otp/[email]/page.tsx`'s identical helper — same reasoning, same defensive decode. */
function decodeEmailParam(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * The TOTP (authenticator-app) second-factor login challenge — the counterpart of
 * `../../otp/[email]/page.tsx` for an account with `twoFactorAuthConfig.method === 'totp'` (see
 * `AuthService.finishLogin`'s own doc). Distinct from `../../../totp/enroll`/`../../../totp/confirm`
 * (this project's TOTP ENROLLMENT pages): this page authenticates an account that has ALREADY
 * enrolled TOTP and is completing an ordinary login, with no session of its own yet — enrollment
 * requires the opposite, an already-authenticated session (see those pages' own doc for why they,
 * uniquely among this feature's pages, need `pageSessionGuard`).
 *
 * Renders `@zanix/iam/ui/pages/login-totp`'s own factory-built view
 * (`createElement`-based, never JSX).
 */
// This page's own `action` calls `AuthService.loginWithTOTPCallback` directly
// (an in-process interactor call), so `LoginController.loginTotpCallback`'s own `@RateLimitGuard`
// (`login.handler.ts`) never runs for a visitor reaching this route. A distinct `app` key
// (`login:totp-callback-page`) keeps its own bucket, isolated from the REST endpoint's own.
@Page({ Interactor: AuthService, action: { Body: TotpLoginRTO } })
@Guard(csrfGuard())
@Guard(
  rateLimitGuard(
    { app: 'login:totp-callback-page', anonymousLimit: freeRateLimit, trustProxyHeader: true },
  ),
)
export default class LoginTotpPage extends SpacePageController<TotpParams, AuthService> {
  public static override head = { title: 'Enter your authenticator code' }

  public override component = TotpLoginView

  public override loader = (ctx: PageContext<TotpParams>) => ({
    lang: ctx.params.lang,
    email: decodeEmailParam(ctx.params.email),
    csrfToken: ctx.csrfToken,
    fieldErrors: ctx.fieldErrors,
    invalidCode: ctx.url.searchParams.get('error') === INVALID_CODE_ERROR,
  })

  public override action = async (ctx: PageActionContext<TotpParams>): Promise<Response> => {
    const body = ctx.body as TotpLoginRTO
    const { lang } = ctx.params
    const email = decodeEmailParam(ctx.params.email)

    try {
      await this.interactor.loginWithTOTPCallback(email, body.code)
    } catch (e) {
      if (e instanceof HttpError && e.status.code === 'FORBIDDEN') {
        return redirectResponse(
          `/${lang}/login/totp/${encodeURIComponent(email)}?error=${INVALID_CODE_ERROR}`,
        )
      }
      throw e
    }

    return redirectResponse(resolvePostLoginRedirect(ctx.url))
  }
}
