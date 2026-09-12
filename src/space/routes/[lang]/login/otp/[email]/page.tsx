import type { PageActionContext, PageContext } from '@zanix/space'

import { Guard } from '@zanix/server'
import { csrfGuard, Page, SpacePageController } from '@zanix/space'
import { HttpError } from '@zanix/errors'
import { OtpView } from 'ui/pages/login-otp/index.ts'
import { AuthService } from 'server/interactors/auth.interactor.ts'
import { OtpLoginRTO } from 'server/handlers/rtos/login.ts'
import { redirectResponse } from 'shared/redirect-response.ts'
import { resolvePostLoginRedirect } from 'utils/constants.ts'

type OtpParams = { lang: string; email: string }

/** Query param this page's own `action` redirects back with on a rejected/expired code. */
const INVALID_CODE_ERROR = 'invalid_code'

/**
 * `ctx.params.email` is whatever the router extracted from the `[email]` path segment — decoded
 * defensively, the same way `PwdRecoveryRTO`'s own constructor decodes the REST layer's identical
 * `:email` param (an email can carry `+`/`%`, and a malformed percent-sequence must degrade to the
 * raw value rather than throw).
 */
function decodeEmailParam(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * The OTP (email/SMS/WhatsApp) second-factor challenge — reached either as the automatic
 * continuation of a password login that triggered 2FA (`../../page.tsx`'s own `action`, which has
 * already dispatched the code by the time it redirects here via `AuthService.finishLogin` →
 * `loginWithOTP`), or from any other flow already holding a dispatched code for this account. This
 * page's own `GET` never dispatches a new code itself — only `AuthService.loginWithOTPCallback`
 * (this page's `action`) is called, so a browser refresh here can never silently send a second code
 * (which the REST layer's own `criticRateLimit` guards against for its own `GET login/otp/:email`
 * endpoint, a concern this page doesn't share since it never calls that path).
 *
 * Rendering now delegates to `@zanix/iam/ui/pages/login-otp`'s own factory-built view
 * (`createElement`-based, never JSX) — the loader/action logic below is unchanged.
 */
@Page({ Interactor: AuthService, action: { Body: OtpLoginRTO } })
@Guard(csrfGuard())
export default class LoginOtpPage extends SpacePageController<OtpParams, AuthService> {
  public static override head = { title: 'Enter your verification code' }

  public override component = OtpView

  public override loader = (ctx: PageContext<OtpParams>) => ({
    lang: ctx.params.lang,
    email: decodeEmailParam(ctx.params.email),
    csrfToken: ctx.csrfToken,
    fieldErrors: ctx.fieldErrors,
    invalidCode: ctx.url.searchParams.get('error') === INVALID_CODE_ERROR,
  })

  public override action = async (ctx: PageActionContext<OtpParams>): Promise<Response> => {
    const body = ctx.body as OtpLoginRTO
    const { lang } = ctx.params
    const email = decodeEmailParam(ctx.params.email)

    try {
      await this.interactor.loginWithOTPCallback(email, body.code)
    } catch (e) {
      if (e instanceof HttpError && e.status.code === 'FORBIDDEN') {
        return redirectResponse(
          `/${lang}/login/otp/${encodeURIComponent(email)}?error=${INVALID_CODE_ERROR}`,
        )
      }
      throw e
    }

    return redirectResponse(resolvePostLoginRedirect(ctx.url))
  }
}
