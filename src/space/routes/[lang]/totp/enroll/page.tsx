import type { PageContext } from '@zanix/space'

import { Guard } from '@zanix/server'
import { csrfGuard, Page, SpacePageController } from '@zanix/space'
import { pageSessionGuard } from '@zanix/auth'
import { Button, Field, Input } from '@zanix/space-ui'
// A NAMED import — see `../../login/[oauth]/page.tsx`'s own identical doc. No draft persistence:
// same single-use-code reasoning as `../../login/otp/[email]/page.tsx` — a stale, restored code
// tied to a since-regenerated `secret` would just be actively wrong, never a convenience.
import { SubmitGuard } from '@zanix/space/comet/react'
import { AuthService } from '../../../../../server/interactors/auth.interactor.ts'
import { renderQrCodeSvg } from '../../../../../utils/qr-code.ts'

type EnrollParams = { lang: string }

type EnrollViewProps = {
  lang: string
  secret: string
  uri: string
  qrCodeSvg: string
  csrfToken?: string
  invalidCode: boolean
}

/** Query param `../confirm/page.tsx`'s own `action` redirects back with on a rejected code. */
const INVALID_CODE_ERROR = 'invalid_code'

const CODE_FIELD_ID = 'totp-enroll-code'

/** This page's own `<form>` id — `SubmitGuard`'s own `formId` target. */
const FORM_ID = 'totp-enroll-form'

function TotpEnrollView({ lang, secret, uri, qrCodeSvg, csrfToken, invalidCode }: EnrollViewProps) {
  return (
    <main>
      <h1>Set up an authenticator app</h1>
      {invalidCode && <p role='alert'>Invalid authenticator code — scan the new code below.</p>}
      {
        // The QR code is the primary path — most authenticator apps scan it directly. The manual
        // secret/link right below it is a real fallback, never removed: some apps only support
        // typed-key entry, and it's what keeps enrollment possible if the QR image itself fails
        // to render (a broken `<img>`/inline-SVG scenario a scan-only flow would have no recovery
        // from).
      }
      <div
        role='img'
        aria-label='Scan this QR code with your authenticator app'
        // deno-lint-ignore react-no-danger
        dangerouslySetInnerHTML={{ __html: qrCodeSvg }}
      />
      <p>
        Scan this in your authenticator app, or enter the key manually: <code>{secret}</code>
      </p>
      <p>
        <a href={uri}>{uri}</a>
      </p>
      {
        // Posts to the SIBLING `totp/confirm` page — both pages share the same `X-Znx-Csrf` cookie
        // (same origin, same cookie name), so the token this page's own `csrfGuard()` issues on
        // `GET` is exactly the one `../confirm/page.tsx`'s own `csrfGuard()` validates on `POST`.
        // `secret` round-trips through this hidden field because `AuthService.totpEnroll` never
        // persists it — see that method's own doc.
      }
      <SubmitGuard formId={FORM_ID} />
      <form method='post' id={FORM_ID} action={`/${lang}/totp/confirm`}>
        <input type='hidden' name='_csrf' value={csrfToken ?? ''} />
        <input type='hidden' name='secret' value={secret} />
        <Field id={CODE_FIELD_ID} label='Authenticator code'>
          {(fieldProps) => <Input {...fieldProps} name='code' type='text' required />}
        </Field>
        <Button type='submit'>Confirm</Button>
      </form>
    </main>
  )
}

/**
 * Begins TOTP (authenticator-app) enrollment for the CURRENT authenticated session —
 * `pageSessionGuard([])` (`@zanix/auth`) is what makes that session available at all: unlike every
 * other page in this feature (which are all establishing a NEW, unauthenticated session),
 * `AuthService.totpEnroll`/`totpConfirm` both read `this.context.session?.subject` internally and
 * throw `UNAUTHORIZED` with none — nothing else derives a session from the refresh-token cookie for
 * a `@zanix/space` page (see that guard's own doc for why a page can't reuse
 * `AuthTokenValidation`/`jwtValidationGuard` directly). `roles: []` — enrollment is something ANY
 * authenticated account may do for itself, not gated behind a specific role/permission
 * (`scopeValidation([], ...)` always resolves `'OK'`, confirmed against `@zanix/auth`'s own
 * `utils/scope.ts`).
 *
 * `AuthService.totpEnroll()` is synchronous and never persists anything — safe to call from a plain
 * `GET` `loader` (unlike the OAuth2 callback's own token exchange, this has no one-time-use
 * side effect to protect).
 */
@Page({ Interactor: AuthService })
@Guard(pageSessionGuard([]))
@Guard(csrfGuard())
export default class TotpEnrollPage extends SpacePageController<EnrollParams, AuthService> {
  public static override head = { title: 'Set up an authenticator app' }

  public override component = TotpEnrollView

  public override loader = (ctx: PageContext<EnrollParams>): EnrollViewProps => {
    const { secret, uri } = this.interactor.totpEnroll()
    return {
      lang: ctx.params.lang,
      secret,
      uri,
      // Rendered from the SAME `uri` the manual link/secret above are built from — never a second,
      // independently-constructed otpauth URL. See `renderQrCodeSvg`'s own doc for why the raw SVG
      // markup returned here is safe to embed via `dangerouslySetInnerHTML`.
      qrCodeSvg: renderQrCodeSvg(uri),
      csrfToken: ctx.csrfToken,
      invalidCode: ctx.url.searchParams.get('error') === INVALID_CODE_ERROR,
    }
  }
}
