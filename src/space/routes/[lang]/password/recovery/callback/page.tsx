import type { PageActionContext, PageContext } from '@zanix/space'

import { Guard } from '@zanix/server'
import { csrfGuard, Page, SpacePageController } from '@zanix/space'
import { HttpError } from '@zanix/errors'
import { rateLimitGuard } from '@zanix/auth'
import { RecoveryCallbackView } from 'ui/pages/password-recovery-callback/index.ts'
import { PasswordService } from 'server/interactors/password.interactor.ts'
import { RecoveryCallbackFormRTO } from './callback-form.rto.ts'
import { redirectResponse } from 'shared/redirect-response.ts'
import { freeRateLimit, resolvePostLoginRedirect } from 'utils/constants.ts'

type CallbackParams = { lang: string }

/** Query param this page's own `action` redirects back with on a rejected code. */
const INVALID_CODE_ERROR = 'invalid_code'
/** Query param this page's own `action` redirects back with when `password`/`confirmPassword`
 * don't match — checked here, never sent to `PasswordService.recoveryCallback`; see
 * `RecoveryCallbackFormRTO`'s own doc. */
const MISMATCH_ERROR = 'mismatch'

/** `?error=` value for a new password `iam`'s active password policy rejected (`BAD_REQUEST`). */
const WEAK_PASSWORD_ERROR = 'weak_password'

/**
 * The password-recovery CONFIRMATION step — verifies the code `../[email]/page.tsx` dispatched and
 * sets a new password, issuing session tokens on success (`PasswordService.recoveryCallback`, the
 * same interactor method `PasswordController.recoveryCallback`, the REST endpoint, calls). No
 * `[email]` route segment of its own, unlike the request step: `PwdRecoveryCbRTO` already carries
 * `email` as a real, validated form field (pre-filled from `../[email]/page.tsx`'s own `?email=`
 * link when present), so a second dynamic segment would only duplicate it. `RecoveryCallbackFormRTO`
 * also carries `confirmPassword` — checked for a match against `password` right here, before ever
 * reaching `PasswordService` (see its own doc for why this isn't the server's own `PwdRecoveryCbRTO`
 * directly).
 *
 * Renders `@zanix/iam/ui/pages/password-recovery-callback`'s own factory-built view
 * (`createElement`-based, never JSX).
 */
// This page's own `action` calls `PasswordService.recoveryCallback` directly
// (an in-process interactor call), so `PasswordController.recoveryCallback`'s own
// `@RateLimitGuard` (`password.handler.ts`) never runs for a visitor reaching this route. A
// distinct `app` key (`pwd:recovery-callback-page`) keeps its own bucket, isolated from the REST
// endpoint's own.
@Page({ Interactor: PasswordService, action: { Body: RecoveryCallbackFormRTO } })
@Guard(csrfGuard())
@Guard(
  rateLimitGuard(
    { app: 'pwd:recovery-callback-page', anonymousLimit: freeRateLimit, trustProxyHeader: true },
  ),
)
export default class PasswordRecoveryCallbackPage
  extends SpacePageController<CallbackParams, PasswordService> {
  public static override head = { title: 'Reset your password' }

  public override component = RecoveryCallbackView

  public override loader = (ctx: PageContext<CallbackParams>) => {
    const email = ctx.url.searchParams.get('email') ?? ''
    return {
      csrfToken: ctx.csrfToken,
      fieldErrors: ctx.fieldErrors,
      submitted: ctx.submitted,
      invalidCode: ctx.url.searchParams.get('error') === INVALID_CODE_ERROR,
      mismatch: ctx.url.searchParams.get('error') === MISMATCH_ERROR,
      weakPassword: ctx.url.searchParams.get('error') === WEAK_PASSWORD_ERROR,
      email,
      // See `RecoveryCallbackViewProps.emailLocked`'s own doc — locked whenever `email` is
      // already known, from ANY source, never tied to a session specifically.
      emailLocked: email !== '',
      nonce: ctx.cspNonce,
    }
  }

  public override action = async (ctx: PageActionContext<CallbackParams>): Promise<Response> => {
    const body = ctx.body as RecoveryCallbackFormRTO
    const { lang } = ctx.params
    // Carried through on every redirect back to this SAME step below — dropping it would blank
    // the email field on re-render, a dead end once `emailLocked` locks it (the visitor can't
    // retype it): see `RecoveryCallbackViewProps.emailLocked`'s own doc.
    const emailParam = `&email=${encodeURIComponent(body.email)}`

    if (body.password !== body.confirmPassword) {
      return redirectResponse(
        `/${lang}/password/recovery/callback?error=${MISMATCH_ERROR}${emailParam}`,
      )
    }

    try {
      await this.interactor.recoveryCallback(body.email, body.code, body.password)
    } catch (e) {
      if (e instanceof HttpError && e.status.code === 'FORBIDDEN') {
        return redirectResponse(
          `/${lang}/password/recovery/callback?error=${INVALID_CODE_ERROR}${emailParam}`,
        )
      }
      if (e instanceof HttpError && e.status.code === 'BAD_REQUEST') {
        return redirectResponse(
          `/${lang}/password/recovery/callback?error=${WEAK_PASSWORD_ERROR}${emailParam}`,
        )
      }
      throw e
    }

    return redirectResponse(resolvePostLoginRedirect(ctx.url))
  }
}
