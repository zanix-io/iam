import type { PageActionContext, PageContext } from '@zanix/space'

import { Guard } from '@zanix/server'
import { csrfGuard, Page, SpacePageController } from '@zanix/space'
import { HttpError } from '@zanix/errors'
import { rateLimitGuard } from '@zanix/auth'
import { OtpView } from 'ui/pages/login-otp/index.ts'
import { AuthService } from 'server/interactors/auth.interactor.ts'
import { OtpLoginRTO } from 'server/handlers/rtos/login.ts'
import { redirectResponse } from 'shared/redirect-response.ts'
import { freeRateLimit, resolvePostLoginRedirect } from 'utils/constants.ts'

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
 * (which the REST layer's own `criticalRateLimit` guards against for its own `GET login/otp/:email`
 * endpoint, a concern this page doesn't share since it never calls that path).
 *
 * Renders `@zanix/iam/ui/pages/login-otp`'s own factory-built view
 * (`createElement`-based, never JSX).
 */
// This page's own `action` calls `AuthService.loginWithOTPCallback` directly
// (an in-process interactor call), so `LoginController.loginOtpCallback`'s own `@RateLimitGuard`
// (`login.handler.ts`) never runs for a visitor reaching this route. A distinct `app` key
// (`login:otp-callback-page`) keeps its own bucket, isolated from the REST endpoint's own.
@Page({ Interactor: AuthService, action: { Body: OtpLoginRTO } })
@Guard(csrfGuard())
@Guard(
  rateLimitGuard(
    { app: 'login:otp-callback-page', anonymousLimit: freeRateLimit, trustProxyHeader: true },
  ),
)
export default class LoginOtpPage extends SpacePageController<OtpParams, AuthService> {
  public static override head = { title: 'Enter your verification code' }

  public override component = OtpView

  public override loader = async (ctx: PageContext<OtpParams>) => {
    const email = decodeEmailParam(ctx.params.email)
    // Best-effort only — the resend/alternate-channel affordance simply doesn't render an
    // alternate option on a lookup failure. A real `try`/`catch`, not a `.catch()`
    // chained onto the call, since a test double or partial mock missing this method entirely
    // throws synchronously (calling `undefined` as a function) rather than returning a rejected
    // promise — `.catch()` alone would never see that.
    let methods: Awaited<ReturnType<AuthService['resolveLoginMethods']>> | null
    try {
      methods = await this.interactor.resolveLoginMethods(email)
    } catch {
      methods = null
    }

    return {
      lang: ctx.params.lang,
      email,
      csrfToken: ctx.csrfToken,
      fieldErrors: ctx.fieldErrors,
      invalidCode: ctx.url.searchParams.get('error') === INVALID_CODE_ERROR,
      nonce: ctx.cspNonce,
      otpNotifier: methods?.otpNotifier ?? null,
      hasVerifiedPhone: methods?.hasVerifiedPhone ?? false,
    }
  }

  public override action = async (ctx: PageActionContext<OtpParams>): Promise<Response> => {
    const body = ctx.body as OtpLoginRTO
    const { lang } = ctx.params
    const email = decodeEmailParam(ctx.params.email)

    let result: Awaited<ReturnType<AuthService['loginWithOTPCallback']>>
    try {
      result = await this.interactor.loginWithOTPCallback(email, body.code)
    } catch (e) {
      if (e instanceof HttpError && e.status.code === 'FORBIDDEN') {
        return redirectResponse(
          `/${lang}/login/otp/${encodeURIComponent(email)}?error=${INVALID_CODE_ERROR}`,
        )
      }
      throw e
    }

    // The linked `users` profile is `'INACTIVE'` — withheld tokens on purpose instead of
    // reactivating silently (see `challengeReactivation`'s own doc). Redirect to a real
    // confirmation screen rather than finishing login here.
    if ('needsReactivationConfirm' in result) {
      return redirectResponse(`/${lang}/login/reactivate/${result.reactivationToken}`)
    }

    return redirectResponse(resolvePostLoginRedirect(ctx.url))
  }
}
