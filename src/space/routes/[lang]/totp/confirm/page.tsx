import type { PageActionContext, RedirectConfig } from '@zanix/space'

import { Guard } from '@zanix/server'
import { csrfGuard, Page, SpacePageController } from '@zanix/space'
import { HttpError } from '@zanix/errors'
import { pageSessionGuard } from '@zanix/auth'
import { TotpConfirmView } from 'ui/pages/totp-confirm/index.ts'
import { AuthService } from 'server/interactors/auth.interactor.ts'
import { TotpConfirmRTO } from 'server/handlers/rtos/password.ts'
import { redirectResponse } from 'shared/redirect-response.ts'
import { postLoginRedirectUrl, resolvePostLoginRedirect } from 'utils/constants.ts'

type ConfirmParams = { lang: string }

/** Query param this page's own `action` redirects back to `../enroll` with on a rejected code. */
const INVALID_CODE_ERROR = 'invalid_code'

/**
 * Confirms a TOTP enrollment via `action` — the counterpart of `../enroll/page.tsx`'s own
 * cross-page form POST. Same `pageSessionGuard([])` requirement as that page, same reasoning — see
 * its own doc.
 *
 * This page's own `GET` is unreachable in any useful sense: the SAME `pageSessionGuard([])` that
 * gates it here ALSO gates `../enroll/page.tsx`, so anyone who can even reach this page's `GET` at
 * all is, by definition, already authenticated — an unauthenticated request never gets past the
 * guard to run `loader`/`component` in the first place, it is rejected with `401` first. There is
 * therefore no scenario where a direct visit here should render a "start from enrollment" message
 * implying the visitor might not be logged in: `redirect` below sends every one of them to `/`
 * instead, matching `login/page.tsx`'s own "an already-authenticated visitor has no reason to see
 * this form" `static redirect` — same `code: 302` reasoning (a session-state-dependent redirect
 * must never be cached as permanent, see that page's own doc). Unlike `login/page.tsx`, this
 * page's own redirect needs no `condition` of its own: the guard has already done that filtering
 * before `redirect` is even evaluated, so omitting `condition` (unconditional, per
 * `RedirectConfig.condition`'s own doc) is the correct match for that guarantee, not a
 * simplification that drops a real case `login/page.tsx` still needs to check for itself.
 *
 * No `loader` either, for the identical reason: `redirect` already fires before `loader` would
 * ever run (see `SpacePageController.handleGet`'s own doc), so one here would be genuine dead code.
 */
@Page({ Interactor: AuthService, action: { Body: TotpConfirmRTO } })
@Guard(pageSessionGuard([]))
@Guard(csrfGuard())
export default class TotpConfirmPage extends SpacePageController<ConfirmParams, AuthService> {
  public static override head = { title: 'Confirm authenticator app' }

  /**
   * Unconditional — see this class's own doc for why no `condition` is needed here, unlike
   * `login/page.tsx`'s own presence-only cookie check. Explicitly typed `RedirectConfig` (rather
   * than left inferred, like `login/page.tsx`'s own object literal) so that `condition`'s real,
   * always-optional shape is preserved for callers introspecting this field directly (e.g. this
   * class's own tests) instead of narrowing to the two keys actually assigned here.
   *
   * `code: 302`, not the framework's own default (`301`, Permanent) — this redirect's own
   * *reachability* is fixed (`pageSessionGuard([])` already guarantees it always fires), but its
   * *target* is not a permanent property of this URL either: caching this as permanent would still
   * be wrong the same way `login/page.tsx`'s own doc explains, since `/en/totp/confirm` itself
   * remains a real, distinct route (reachable via POST) that a `301` risks a client resolving away
   * from entirely on a future request.
   */
  public static override redirect: RedirectConfig = { to: postLoginRedirectUrl(), code: 302 }

  public override component = TotpConfirmView

  public override action = async (ctx: PageActionContext<ConfirmParams>): Promise<Response> => {
    const body = ctx.body as TotpConfirmRTO
    const { lang } = ctx.params

    try {
      await this.interactor.totpConfirm(body.secret, body.code)
    } catch (e) {
      if (e instanceof HttpError && e.status.code === 'FORBIDDEN') {
        return redirectResponse(`/${lang}/totp/enroll?error=${INVALID_CODE_ERROR}`)
      }
      throw e
    }

    return redirectResponse(resolvePostLoginRedirect(ctx.url))
  }
}
