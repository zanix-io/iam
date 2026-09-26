import type { PageActionContext, PageContext } from '@zanix/space'

import { Guard } from '@zanix/server'
import { csrfGuard, Page, SpacePageController } from '@zanix/space'
import { HttpError } from '@zanix/errors'
import {
  GITHUB_OAUTH2_CLIENT_ID_ENV,
  GOOGLE_OAUTH2_CLIENT_ID_ENV,
  rateLimitGuard,
} from '@zanix/auth'
import { LoginView } from 'ui/pages/login/index.ts'
import type { LoginViewProps } from 'ui/pages/login/index.ts'
import { AuthService } from 'server/interactors/auth.interactor.ts'
import { LoginRTO } from 'server/handlers/rtos/login.ts'
import { freeRateLimit } from 'utils/constants.ts'
import {
  OAUTH_PROVIDERS,
  postLoginRedirectUrl,
  PRIVACY_NOTICE_URL_ENV,
  resolvePostLoginRedirect,
  TERMS_AND_CONDITIONS_URL_ENV,
  withRedirectToParam,
} from 'utils/constants.ts'
import { hasSessionCookie } from '../../../session-cookie.ts'
import { redirectResponse } from 'shared/redirect-response.ts'

type LoginParams = { lang: string }

/** Query param the login `action` redirects back with on a rejected credential — read by `loader`
 * below, surfaced by `LoginView` as a plain, static error message. Not a flash/session mechanism: a
 * real, stateless PRG (post-redirect-get) query param. */
const INVALID_CREDENTIALS_ERROR = 'invalid_credentials'
/** Query param a rate-limited attempt is surfaced with — kept for parity with a Tier-2 consumer
 * (`docs/consuming-iam.md`) calling this SAME `LoginView` after catching a `429` from
 * `POST /login/login` over HTTP. This page's own `@Guard(rateLimitGuard(...))` (below) answers a
 * rejection directly with the guard's own `TOO_MANY_REQUESTS` response, before `loader`/`action`
 * run, so this page itself never redirects with it; `loader` still reads it to supply
 * `LoginViewProps.rateLimited` from the URL rather than a hardcoded `false`. */
const RATE_LIMITED_ERROR = 'rate_limited'
/** Same parity role as {@link RATE_LIMITED_ERROR}, for `LoginViewProps.unexpectedError` (a
 * non-`403`/`429` upstream failure): this page's own `action` never redirects with it — its `catch`
 * below only distinguishes `FORBIDDEN` and rethrows anything else unchanged. */
const UNEXPECTED_ERROR = 'unexpected_error'

/**
 * Maps each of `OAUTH_PROVIDERS` (every provider this project's CODE knows how to speak to) to the
 * env var `auth.app.ts`'s own `resources` construction gates it on — the same source of truth, so
 * this page can never advertise a provider a host hasn't actually configured. `Deno.env` is read
 * directly (not `resolveResource`/`AuthService`) because this is a plain presence check with no
 * connector to construct — the identical `Deno.env.has(...)` condition `auth.app.ts` itself uses.
 */
const OAUTH_PROVIDER_ENV: Record<typeof OAUTH_PROVIDERS[number], string> = {
  google: GOOGLE_OAUTH2_CLIENT_ID_ENV,
  github: GITHUB_OAUTH2_CLIENT_ID_ENV,
}

/** The subset of `OAUTH_PROVIDERS` this host actually has configured — see
 * `OAUTH_PROVIDER_ENV`'s own doc. */
function configuredOauthProviders(): typeof OAUTH_PROVIDERS[number][] {
  return OAUTH_PROVIDERS.filter((provider) => Deno.env.has(OAUTH_PROVIDER_ENV[provider]))
}

/**
 * This project's own password-login page — a NORMAL `@zanix/space` route with an `action` calling
 * `AuthService.loginWithPassword` directly. `HttpOnly`,
 * `SameSite=Strict` session cookies, exactly like any other `@zanix/space` page — no bespoke cookie
 * handling anywhere in this file: `sessionHeadersInterceptor` (registered globally via `mod.ts`'s
 * own `import '@zanix/auth/core'`) writes them onto the response on its own, once
 * `AuthService.loginWithPassword` has set the session through `ZanixAuthProvider`'s own
 * request-scoped context — the SAME context resolution `LoginController.login` (the REST endpoint
 * calling this identical interactor method) relies on: neither call site threads an explicit `ctx`,
 * both resolve through
 * `ContextualBaseClass`'s own per-request `this.context`, populated by `@zanix/server`'s
 * `contextSettingPipe` before ANY handler (REST or SSR) runs.
 *
 * `@Guard(csrfGuard())` below `@Page()` issues a token on this page's `GET` (rendered into the
 * hidden `_csrf` field) and requires it back on the `POST`.
 */
// This page's own `action` calls `AuthService.loginWithPassword` directly (an in-process
// interactor call, never an HTTP round trip), so `LoginController.login`'s own
// `@RateLimitGuard({ app: 'login:password', ... })` (`login.handler.ts`) never runs for a visitor
// reaching this route — this guard is what protects it. A distinct `app` key
// (`login:password-page`, not `'login:password'`) keeps its own bucket, isolated from the REST
// endpoint's — the same "every anonymous `@RateLimitGuard` carries its own `app` value" rule
// `login.handler.ts`'s own doc establishes, extended across the REST/native-page boundary.
@Page({ Interactor: AuthService, action: { Body: LoginRTO } })
@Guard(csrfGuard())
@Guard(
  rateLimitGuard({
    app: 'login:password-page',
    anonymousLimit: freeRateLimit,
    trustProxyHeader: true,
  }),
)
export default class LoginPage extends SpacePageController<LoginParams, AuthService> {
  public static override head = { title: 'Sign in' }

  /**
   * An already-signed-in request has no reason to see the login form again — bounce it away.
   * Presence-only (`hasSessionCookie`, no verification — a present-but-invalid/expired cookie
   * still redirects away from here, which is harmless: the destination has no session-derived data
   * of its own to protect either).
   *
   * Redirects to {@linkcode postLoginRedirectUrl} (`POST_LOGIN_REDIRECT_URL`, default `/`). This
   * project ships no dashboard/account page, so with the default, `langPreHandler` redirects the
   * follow-up GET to `/{lang}/`, which renders the built-in not-found view — set
   * `POST_LOGIN_REDIRECT_URL` to the host's own landing page.
   *
   * `code: 302` — this redirect's own condition is session-state-dependent (fires only while
   * logged in); the framework's own default (`301`, Permanent) would let a browser cache "GET
   * /{lang}/login redirects to /" forever, which would strand this page unreachable even AFTER a
   * later logout.
   */
  public static override redirect = {
    to: postLoginRedirectUrl(),
    code: 302 as const,
    condition: (ctx: PageContext<unknown>) => hasSessionCookie(ctx.request),
  }

  public override component = LoginView

  public override loader = (ctx: PageContext<LoginParams>): LoginViewProps => ({
    lang: ctx.params.lang,
    csrfToken: ctx.csrfToken,
    fieldErrors: ctx.fieldErrors,
    submitted: ctx.submitted,
    invalidCredentials: ctx.url.searchParams.get('error') === INVALID_CREDENTIALS_ERROR,
    rateLimited: ctx.url.searchParams.get('error') === RATE_LIMITED_ERROR,
    unexpectedError: ctx.url.searchParams.get('error') === UNEXPECTED_ERROR,
    oauthProviders: configuredOauthProviders(),
    termsUrl: Deno.env.get(TERMS_AND_CONDITIONS_URL_ENV),
    privacyUrl: Deno.env.get(PRIVACY_NOTICE_URL_ENV),
  })

  public override action = async (
    ctx: PageActionContext<LoginParams>,
  ): Promise<Response> => {
    // `body`'s real static type is `unknown` — `SpacePageController` fixes `PageActionContext`'s
    // own `Body` generic regardless of what `@Page({ action: { Body } })` validates at runtime —
    // cast below, not narrowed here.
    const body = ctx.body as LoginRTO
    const { lang } = ctx.params

    let result: Awaited<ReturnType<AuthService['loginWithPassword']>>
    try {
      result = await this.interactor.loginWithPassword(body.email, body.password)
    } catch (e) {
      // `loginWithPassword` throws `FORBIDDEN` both for a genuinely bad credential AND for an
      // inactive/deleted linked profile (`UsersRepository.assertActive`, called internally) — see
      // `AuthService`'s own doc for why both collapse to the same status/redirect here. Anything
      // else is a real server-side fault and propagates unchanged.
      if (e instanceof HttpError && e.status.code === 'FORBIDDEN') {
        return redirectResponse(
          withRedirectToParam(`/${lang}/login?error=${INVALID_CREDENTIALS_ERROR}`, ctx.url),
        )
      }
      throw e
    }

    // Real token issuance carries `accessToken` — the 2FA-challenge branch (`AuthService.finishLogin`)
    // returns only `{ message }` instead, with no other field in common. `'accessToken' in result`
    // is therefore a safe, structural discriminator between the two shapes.
    if ('accessToken' in result) {
      return redirectResponse(resolvePostLoginRedirect(ctx.url))
    }

    // 2FA required: `method` names the step — `'totp'` for an authenticator code, a notifier for a
    // code just sent through it.
    const challengePath = 'method' in result && result.method === 'totp' ? 'totp' : 'otp'
    return redirectResponse(
      withRedirectToParam(
        `/${lang}/login/${challengePath}/${encodeURIComponent(body.email)}`,
        ctx.url,
      ),
    )
  }
}
