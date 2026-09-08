import type { PageActionContext, PageContext } from '@zanix/space'

import { Guard } from '@zanix/server'
import { csrfGuard, Page, SpacePageController } from '@zanix/space'
import { HttpError } from '@zanix/errors'
import { GITHUB_OAUTH2_CLIENT_ID_ENV, GOOGLE_OAUTH2_CLIENT_ID_ENV } from '@zanix/auth'
import { Button, Field, Input } from '@zanix/space-ui'
// A NAMED import — `@zanix/space/comet/react` carries more than one ready-made Comet, so (unlike
// this project's own former `submit-guard.comet.tsx`) there's no single default. `ManagedForm`
// composes `FormDraftPersistence`/`SubmitGuard`/`UnsavedChangesGuard` under one `formId` — this
// page enables the first two (see {@linkcode DRAFT_STORAGE_KEY}'s own doc for why draft persistence
// is worth it here), never `unsavedChanges`: this form's own real in-app link (the OAuth2 "Continue
// with..." list) is a same-origin `<a>` Orbit intercepts client-side, with no exposed "confirm
// before navigating" hook (`ManagedForm`'s own known gap) — a native `beforeunload` prompt would
// therefore only ever fire on an actual tab close, not the one navigation a signed-in-in-progress
// operator is actually likely to take.
import { ManagedForm } from '@zanix/space/comet/react'
import { AuthService } from '../../../../server/interactors/auth.interactor.ts'
import { LoginRTO } from '../../../../server/handlers/rtos/login.ts'
import { OAUTH_PROVIDERS, TERMS_AND_CONDITIONS_URL_ENV } from '../../../../utils/constants.ts'
import { hasSessionCookie } from '../../../session-cookie.ts'
// A RELATIVE path, deliberately — `zanix space dev`'s own route-discovery step resolves a file
// under `routesDir` against `@zanix/cli`'s OWN configuration, never this project's, so a bare
// `shared/`-aliased import here would silently resolve to `@zanix/cli`'s own, differently targeted
// internal `shared/` directory instead (confirmed real, see `redirect-response.ts`'s own doc and
// `console`'s identical precedent). No import-map entry needed for a relative path.
import { redirectResponse } from '../../../../shared/redirect-response.ts'

type LoginParams = { lang: string }

/** Query param the login `action` redirects back with on a rejected credential — read by `loader`
 * below, surfaced by `LoginView` as a plain, static error message. Not a flash/session mechanism: a
 * real, stateless PRG (post-redirect-get) query param. */
const INVALID_CREDENTIALS_ERROR = 'invalid_credentials'

/** `Field` ids for the two real inputs below — plain identity/label wiring only. */
const EMAIL_FIELD_ID = 'login-email'
const PASSWORD_FIELD_ID = 'login-password'

/** This page's own `<form>` id — `ManagedForm`'s own `formId` target. */
const FORM_ID = 'login-form'

/**
 * `FormDraftPersistence`'s own `storageKey` for this form — a plain, `[lang]`-independent literal
 * (never derived from `location.pathname`, see that Comet's own doc for why: this project's
 * `[lang]`-segment routing renders this SAME logical form at a different pathname per language,
 * which a pathname-derived key would fragment an operator's own in-progress draft across). Recovers
 * a typed `email` after an accidental refresh or navigate-away-and-back; `password` is excluded
 * automatically (every `type="password"` field always is), so nothing sensitive round-trips through
 * `sessionStorage` here.
 */
const DRAFT_STORAGE_KEY = 'login'

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

type LoginViewProps = {
  lang: string
  csrfToken?: string
  fieldErrors?: Record<string, unknown>
  submitted?: Record<string, string>
  invalidCredentials: boolean
  /** Which OAuth2 providers this host actually has configured (`auth.app.ts`'s own `resources`) —
   * never hardcoded, so a deployment configuring only Google (or neither) doesn't render a dead
   * "Continue with GitHub" link. Resolved server-side in `loader` (see that method's own doc). */
  oauthProviders: readonly string[]
  /** This host's own Terms and Conditions URL — presence-gated, the same convention
   * {@linkcode OAUTH_PROVIDER_ENV} already applies per OAuth2 provider (see
   * `TERMS_AND_CONDITIONS_URL_ENV`'s own doc). `undefined` when unset, in which case no link
   * renders at all — purely informational, never a submit-blocking requirement. */
  termsUrl?: string
}

/** Extracts a single field's already-resolved error message(s) out of `PageFieldErrors`.
 * `undefined` (not `[]`) when the field has no error, so `Field`'s own "was an error given at all"
 * branch stays accurate. */
function fieldMessage(
  property: string,
  fieldErrors: LoginViewProps['fieldErrors'],
): string[] | undefined {
  const entries = fieldErrors?.[property] as { constraints?: string[] }[] | undefined
  const messages = entries?.flatMap((entry) => entry.constraints ?? [])
  return messages?.length ? messages : undefined
}

function LoginView(
  { lang, csrfToken, fieldErrors, submitted, invalidCredentials, oauthProviders, termsUrl }:
    LoginViewProps,
) {
  return (
    <main>
      <h1>Sign in</h1>
      {invalidCredentials && <p role='alert'>Invalid email or password.</p>}
      <ManagedForm
        formId={FORM_ID}
        draft={{ storageKey: DRAFT_STORAGE_KEY, hasServerValues: submitted !== undefined }}
        submitGuard
      />
      <form method='post' id={FORM_ID}>
        <input type='hidden' name='_csrf' value={csrfToken ?? ''} />
        <Field id={EMAIL_FIELD_ID} label='Email' error={fieldMessage('email', fieldErrors)}>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              name='email'
              type='email'
              defaultValue={submitted?.email ?? ''}
              required
            />
          )}
        </Field>
        <Field
          id={PASSWORD_FIELD_ID}
          label='Password'
          error={fieldMessage('password', fieldErrors)}
        >
          {(fieldProps) => <Input {...fieldProps} name='password' type='password' required />}
        </Field>
        <Button type='submit'>Sign in</Button>
      </form>
      {termsUrl && (
        <p>
          <a href={termsUrl}>Terms and Conditions</a>
        </p>
      )}
      {oauthProviders.length > 0 && (
        <ul>
          {oauthProviders.map((provider) => (
            <li key={provider}>
              <a href={`/${lang}/login/${provider}`}>Continue with {provider}</a>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

/**
 * This project's own password-login page — a NORMAL `@zanix/space` route with an `action` calling
 * `AuthService.loginWithPassword` directly (this project OWNS a real, already-tested multi-user
 * `AuthService`, unlike `console`'s own single-bootstrap-operator `LoginInteractor`, so this page
 * needs no bespoke bootstrap-operator handling of its own). `HttpOnly`,
 * `SameSite=Strict` session cookies, exactly like any other `@zanix/space` page — no bespoke cookie
 * handling anywhere in this file: `sessionHeadersInterceptor` (registered globally via `mod.ts`'s
 * own `import '@zanix/auth/core'`) writes them onto the response on its own, once
 * `AuthService.loginWithPassword` has set the session through `ZanixAuthProvider`'s own
 * request-scoped context — the SAME context resolution `LoginController.login` (the REST endpoint
 * calling this identical interactor method) already relies on, confirmed by reading
 * `AuthService`'s own source: neither call site threads an explicit `ctx`, both resolve through
 * `ContextualBaseClass`'s own per-request `this.context`, populated by `@zanix/server`'s
 * `contextSettingPipe` before ANY handler (REST or SSR) runs.
 *
 * `@Guard(csrfGuard())` below `@Page()` issues a token on this page's `GET` (rendered into the
 * hidden `_csrf` field above) and requires it back on the `POST`.
 */
@Page({ Interactor: AuthService, action: { Body: LoginRTO } })
@Guard(csrfGuard())
export default class LoginPage extends SpacePageController<LoginParams, AuthService> {
  public static override head = { title: 'Sign in' }

  /**
   * An already-signed-in request has no reason to see the login form again — bounce it away.
   * Presence-only (`hasSessionCookie`, no verification — a present-but-invalid/expired cookie
   * still redirects away from here, which is harmless: the destination has no session-derived data
   * of its own to protect either).
   *
   * Redirects to the plain, UNPREFIXED `/` — this project has no dashboard/account page yet, so
   * `langPreHandler` picks the follow-up GET back up and redirects it again to `/{lang}/`, which
   * currently has no page of its own either and renders the built-in default not-found view.
   * Harmless and expected until a real landing page exists; replace this target once one does.
   *
   * `code: 302` — this redirect's own condition is session-state-dependent (fires only while
   * logged in); the framework's own default (`301`, Permanent) would let a browser cache "GET
   * /{lang}/login redirects to /" forever, which would strand this page unreachable even AFTER a
   * later logout.
   */
  public static override redirect = {
    to: '/',
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
    oauthProviders: configuredOauthProviders(),
    termsUrl: Deno.env.get(TERMS_AND_CONDITIONS_URL_ENV),
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
        return redirectResponse(`/${lang}/login?error=${INVALID_CREDENTIALS_ERROR}`)
      }
      throw e
    }

    // Real token issuance carries `accessToken` — the 2FA-challenge branch (`AuthService.finishLogin`)
    // returns only `{ message }` instead, with no other field in common. `'accessToken' in result`
    // is therefore a safe, structural discriminator between the two shapes.
    if ('accessToken' in result) {
      return redirectResponse('/')
    }

    // 2FA required. `finishLogin`'s two challenge branches return the SAME `{ message }` shape
    // with no machine-checkable discriminator field of their own — the authenticator-app (TOTP)
    // branch's message is the only one containing "authenticator", so that substring is what
    // distinguishes it from every notifier-delivered OTP method (email/SMS/WhatsApp), which all
    // share the other message. `'message' in result` also structurally covers `loginWithOTP`'s
    // third, `{ response: string }` shape (unreachable from THIS call path, but part of
    // `loginWithPassword`'s own declared return type) by falling back to the OTP challenge for it.
    const challengePath = 'message' in result && result.message.includes('authenticator')
      ? 'totp'
      : 'otp'
    return redirectResponse(`/${lang}/login/${challengePath}/${encodeURIComponent(body.email)}`)
  }
}
