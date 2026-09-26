import type { PageActionContext, PageContext } from '@zanix/space'

import { Guard } from '@zanix/server'
import { csrfGuard, Page, SpacePageController } from '@zanix/space'
import { pageSessionGuard } from '@zanix/auth'
import { PhoneEnrollView } from 'ui/pages/phone-enroll/index.ts'
import { AuthService } from 'server/interactors/auth.interactor.ts'
import { PhoneEnrollRTO } from 'server/handlers/rtos/password.ts'
import { redirectResponse } from 'shared/redirect-response.ts'

type EnrollParams = { lang: string }

/** Query param `../confirm/page.tsx`'s own `action` redirects back with on a rejected code. */
const INVALID_CODE_ERROR = 'invalid_code'

/**
 * Begins phone verification for the CURRENT authenticated session — same `pageSessionGuard([])`
 * requirement/reasoning as `../../totp/enroll/page.tsx`: `AuthService.phoneEnroll`/`phoneConfirm`
 * both read `this.context.session?.subject` internally, and nothing else derives a session from
 * the refresh-token cookie for a `@zanix/space` page. `roles: []` — verifying a phone number is
 * something ANY authenticated account may do for itself.
 *
 * Unlike `totp/enroll`, this page's own `GET` dispatches nothing (there's no phone number to send
 * a code to until the visitor actually submits one) — the SMS only goes out from this page's own
 * `action`, which then redirects to `../confirm`, carrying `phone` along so that sibling page can
 * verify against the SAME number `phoneEnroll` just dispatched to.
 *
 * A caller that already knows the number (an app's own profile form) posts straight to this SAME
 * `action` from a small `<form>` of its own — never a GET to this page first — the same "own the
 * redirect-triggering side effect via a real form, never an intermediate GET" shape
 * `login/[oauth]/page.tsx` uses for starting OAuth2. This page's own `component`/`GET` only
 * renders for the plain, unprefilled entry point (e.g. a consumer app's own "Verify phone" link,
 * reached when no phone is known yet).
 */
@Page({ Interactor: AuthService, action: { Body: PhoneEnrollRTO } })
@Guard(pageSessionGuard([]))
@Guard(csrfGuard())
export default class PhoneEnrollPage extends SpacePageController<EnrollParams, AuthService> {
  public static override head = { title: 'Verify your phone number' }

  public override component = PhoneEnrollView

  public override loader = (ctx: PageContext<EnrollParams>) => ({
    lang: ctx.params.lang,
    csrfToken: ctx.csrfToken,
    invalidCode: ctx.url.searchParams.get('error') === INVALID_CODE_ERROR,
    fieldErrors: ctx.fieldErrors,
  })

  public override action = async (ctx: PageActionContext<EnrollParams>): Promise<Response> => {
    const body = ctx.body as PhoneEnrollRTO
    const { lang } = ctx.params

    await this.interactor.phoneEnroll(body.phone)

    return redirectResponse(`/${lang}/phone/confirm?phone=${encodeURIComponent(body.phone)}`)
  }
}
