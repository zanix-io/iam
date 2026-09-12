import type { PageContext } from '@zanix/space'

import { Guard } from '@zanix/server'
import { csrfGuard, Page, SpacePageController } from '@zanix/space'
import { pageSessionGuard } from '@zanix/auth'
import { TotpEnrollView } from 'ui/pages/totp-enroll/index.ts'
import { AuthService } from 'server/interactors/auth.interactor.ts'
import { renderQrCodeSvg } from 'utils/qr-code.ts'

type EnrollParams = { lang: string }

/** Query param `../confirm/page.tsx`'s own `action` redirects back with on a rejected code. */
const INVALID_CODE_ERROR = 'invalid_code'

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
 *
 * Rendering now delegates to `@zanix/iam/ui/pages/totp-enroll`'s own factory-built view
 * (`createElement`-based, never JSX) — the loader logic below is unchanged.
 */
@Page({ Interactor: AuthService })
@Guard(pageSessionGuard([]))
@Guard(csrfGuard())
export default class TotpEnrollPage extends SpacePageController<EnrollParams, AuthService> {
  public static override head = { title: 'Set up an authenticator app' }

  public override component = TotpEnrollView

  public override loader = (ctx: PageContext<EnrollParams>) => {
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
