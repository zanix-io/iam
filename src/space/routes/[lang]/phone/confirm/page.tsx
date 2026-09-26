import type { PageActionContext, PageContext } from '@zanix/space'

import { Guard } from '@zanix/server'
import { csrfGuard, Page, SpacePageController } from '@zanix/space'
import { HttpError } from '@zanix/errors'
import { pageSessionGuard, rateLimitGuard } from '@zanix/auth'
import { PhoneConfirmView } from 'ui/pages/phone-confirm/index.ts'
import { AuthService } from 'server/interactors/auth.interactor.ts'
import { PhoneConfirmRTO } from 'server/handlers/rtos/password.ts'
import { redirectResponse } from 'shared/redirect-response.ts'
import { freeRateLimit, resolvePostLoginRedirect } from 'utils/constants.ts'
import { phoneConfirmRateLimitIdentityGuard } from 'utils/phone-confirm-rate-limit-guard.ts'

type ConfirmParams = { lang: string }

/** `?error=` value this page's own `action` redirects back to `../enroll` with on a rejected
 * code. */
const INVALID_CODE_ERROR = 'invalid_code'

/**
 * Confirms phone verification — the counterpart of `../enroll/page.tsx`'s own redirect here after
 * dispatching the SMS code. Same `pageSessionGuard([])` requirement/reasoning as that page.
 *
 * `phone` arrives as a `?phone=` query param (never a path segment — this route carries no
 * `[phone]` param of its own) and round-trips through this page's own hidden form field, the same
 * "carry an enrollment-in-progress value the server never persisted yet" shape `totp/confirm`'s
 * own `secret` hidden field establishes for TOTP.
 *
 * Code attempts are limited to `freeRateLimit` per signed-in visitor, the same ceiling as
 * `POST /login/phone/confirm`: the `action` calls `AuthService` in process, so the REST route's guards
 * never run here. Guards apply bottom-up: the session guard, then
 * `phoneConfirmRateLimitIdentityGuard` (see its doc for why the session's own token limit is
 * replaced), then `rateLimitGuard` under its own `phone:confirm-page` bucket.
 */
@Page({ Interactor: AuthService, action: { Body: PhoneConfirmRTO } })
@Guard(
  rateLimitGuard(
    { app: 'phone:confirm-page', anonymousLimit: freeRateLimit, trustProxyHeader: true },
  ),
)
@Guard(phoneConfirmRateLimitIdentityGuard())
@Guard(pageSessionGuard([]))
@Guard(csrfGuard())
export default class PhoneConfirmPage extends SpacePageController<ConfirmParams, AuthService> {
  public static override head = { title: 'Confirm your phone number' }

  public override component = PhoneConfirmView

  public override loader = (ctx: PageContext<ConfirmParams>) => ({
    lang: ctx.params.lang,
    phone: ctx.url.searchParams.get('phone') ?? '',
    csrfToken: ctx.csrfToken,
    fieldErrors: ctx.fieldErrors,
    invalidCode: ctx.url.searchParams.get('error') === INVALID_CODE_ERROR,
  })

  public override action = async (ctx: PageActionContext<ConfirmParams>): Promise<Response> => {
    const body = ctx.body as PhoneConfirmRTO
    const { lang } = ctx.params

    try {
      await this.interactor.phoneConfirm(body.phone, body.code)
    } catch (e) {
      if (e instanceof HttpError && e.status.code === 'FORBIDDEN') {
        return redirectResponse(
          `/${lang}/phone/enroll?error=${INVALID_CODE_ERROR}`,
        )
      }
      throw e
    }

    return redirectResponse(resolvePostLoginRedirect(ctx.url))
  }
}
