import type { PageActionContext, PageContext } from '@zanix/space'

import { Guard } from '@zanix/server'
import { csrfGuard, Page, SpacePageController } from '@zanix/space'
import { HttpError } from '@zanix/errors'
import { RecoveryCallbackView } from 'ui/pages/password-recovery-callback/index.ts'
import { PasswordService } from 'server/interactors/password.interactor.ts'
import { PwdRecoveryCbRTO } from 'server/handlers/rtos/password.ts'
import { redirectResponse } from 'shared/redirect-response.ts'
import { resolvePostLoginRedirect } from 'utils/constants.ts'

type CallbackParams = { lang: string }

/** Query param this page's own `action` redirects back with on a rejected code. */
const INVALID_CODE_ERROR = 'invalid_code'

/**
 * The password-recovery CONFIRMATION step — verifies the code `../[email]/page.tsx` dispatched and
 * sets a new password, issuing session tokens on success (`PasswordService.recoveryCallback`, the
 * same interactor method `PasswordController.recoveryCallback`, the REST endpoint, calls). No
 * `[email]` route segment of its own, unlike the request step: `PwdRecoveryCbRTO` already carries
 * `email` as a real, validated form field (pre-filled from `../[email]/page.tsx`'s own `?email=`
 * link when present), so a second dynamic segment would only duplicate it.
 *
 * Rendering now delegates to `@zanix/iam/ui/pages/password-recovery-callback`'s own factory-built
 * view (`createElement`-based, never JSX) — the loader/action logic below is unchanged.
 */
@Page({ Interactor: PasswordService, action: { Body: PwdRecoveryCbRTO } })
@Guard(csrfGuard())
export default class PasswordRecoveryCallbackPage
  extends SpacePageController<CallbackParams, PasswordService> {
  public static override head = { title: 'Reset your password' }

  public override component = RecoveryCallbackView

  public override loader = (ctx: PageContext<CallbackParams>) => ({
    csrfToken: ctx.csrfToken,
    fieldErrors: ctx.fieldErrors,
    submitted: ctx.submitted,
    invalidCode: ctx.url.searchParams.get('error') === INVALID_CODE_ERROR,
    email: ctx.url.searchParams.get('email') ?? '',
  })

  public override action = async (ctx: PageActionContext<CallbackParams>): Promise<Response> => {
    const body = ctx.body as PwdRecoveryCbRTO
    const { lang } = ctx.params

    try {
      await this.interactor.recoveryCallback(body.email, body.code, body.password)
    } catch (e) {
      if (e instanceof HttpError && e.status.code === 'FORBIDDEN') {
        return redirectResponse(`/${lang}/password/recovery/callback?error=${INVALID_CODE_ERROR}`)
      }
      throw e
    }

    return redirectResponse(resolvePostLoginRedirect(ctx.url))
  }
}
