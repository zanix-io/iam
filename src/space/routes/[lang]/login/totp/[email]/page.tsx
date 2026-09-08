import type { PageActionContext, PageContext } from '@zanix/space'

import { Guard } from '@zanix/server'
import { csrfGuard, Page, SpacePageController } from '@zanix/space'
import { HttpError } from '@zanix/errors'
import { Button, Field, Input } from '@zanix/space-ui'
// A NAMED import — see `../../../login/[oauth]/page.tsx`'s own identical doc. No draft persistence
// here: same reasoning as `../otp/[email]/page.tsx` — an authenticator code is single-use, so
// restoring a stale one would be actively unhelpful.
import { SubmitGuard } from '@zanix/space/comet/react'
import { AuthService } from '../../../../../../server/interactors/auth.interactor.ts'
import { TotpLoginRTO } from '../../../../../../server/handlers/rtos/login.ts'
// Relative — see `../../../page.tsx`'s (the plain login page's) own identical doc for why a bare
// `shared/`-aliased import is unsafe from anywhere under `routesDir`.
import { redirectResponse } from '../../../../../../shared/redirect-response.ts'

type TotpParams = { lang: string; email: string }

/** Query param this page's own `action` redirects back with on a rejected code. */
const INVALID_CODE_ERROR = 'invalid_code'

const CODE_FIELD_ID = 'totp-code'

/** This page's own `<form>` id — `SubmitGuard`'s own `formId` target. */
const FORM_ID = 'login-totp-form'

/** See `login/otp/[email]/page.tsx`'s identical helper — same reasoning, same defensive decode. */
function decodeEmailParam(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

type TotpViewProps = {
  lang: string
  email: string
  csrfToken?: string
  fieldErrors?: Record<string, unknown>
  invalidCode: boolean
}

function TotpLoginView({ lang, email, csrfToken, fieldErrors, invalidCode }: TotpViewProps) {
  const codeErrors = (fieldErrors?.code as { constraints?: string[] }[] | undefined)
    ?.flatMap((entry) => entry.constraints ?? [])
  return (
    <main>
      <h1>Enter your authenticator code</h1>
      <p>Signing in as {email}.</p>
      {invalidCode && <p role='alert'>Invalid authenticator code.</p>}
      <SubmitGuard formId={FORM_ID} />
      <form method='post' id={FORM_ID}>
        <input type='hidden' name='_csrf' value={csrfToken ?? ''} />
        <input type='hidden' name='email' value={email} />
        <Field
          id={CODE_FIELD_ID}
          label='Authenticator code'
          error={codeErrors?.length ? codeErrors : undefined}
        >
          {(fieldProps) => <Input {...fieldProps} name='code' type='text' required />}
        </Field>
        <Button type='submit'>Verify</Button>
      </form>
      <p>
        <a href={`/${lang}/login`}>Back to sign in</a>
      </p>
    </main>
  )
}

/**
 * The TOTP (authenticator-app) second-factor login challenge — the counterpart of
 * `../../otp/[email]/page.tsx` for an account with `twoFactorAuthConfig.method === 'totp'` (see
 * `AuthService.finishLogin`'s own doc). Distinct from `../../../totp/enroll`/`../../../totp/confirm`
 * (this project's TOTP ENROLLMENT pages): this page authenticates an account that has ALREADY
 * enrolled TOTP and is completing an ordinary login, with no session of its own yet — enrollment
 * requires the opposite, an already-authenticated session (see those pages' own doc for why they,
 * uniquely among this feature's pages, need `pageSessionGuard`).
 */
@Page({ Interactor: AuthService, action: { Body: TotpLoginRTO } })
@Guard(csrfGuard())
export default class LoginTotpPage extends SpacePageController<TotpParams, AuthService> {
  public static override head = { title: 'Enter your authenticator code' }

  public override component = TotpLoginView

  public override loader = (ctx: PageContext<TotpParams>): TotpViewProps => ({
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

    return redirectResponse('/')
  }
}
