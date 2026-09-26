import type { OAuthAuthorizeRTO, OAuthTokenExchangeRTO } from '../handlers/rtos/oauth-provider.ts'

import { HttpError } from '@zanix/errors'
import { Interactor, ZanixInteractor } from '@zanix/server'
import { addTokenToBlockList, checkTokenBlockList, deriveSessionToken } from '@zanix/auth'
import { redirectResponse } from 'shared/redirect-response.ts'
import { REDIRECT_TO_PARAM, REST_API_PREFIX } from 'utils/constants.ts'
import { DEFAULT_LANG } from 'space/constants.ts'
import {
  findOAuthProviderClient,
  isRegisteredRedirectUri,
  mintAuthorizationCode,
  timingSafeStringEqual,
  verifyAuthorizationCode,
} from 'utils/oauth-provider.ts'
import { AuthService } from './auth.interactor.ts'

/**
 * Business logic for the `oauth-provider` domain — this project acting as the OAuth2/OIDC
 * AUTHORIZATION SERVER for a host application, the opposite role from `AuthService`'s own
 * `loginWithOauth`/`loginWithOauthCallback` (this project as a CLIENT of Google/GitHub).
 *
 * **Trust step design, spelled out deliberately**: `exchangeCode`'s `client_id`/`client_secret`
 * check is plain OAuth2 confidential-client authentication (RFC 6749 §2.3.1), NOT
 * `@zanix/auth`'s own `createServiceAssertion`/`exchangeServiceCredential` machine-to-machine
 * mechanism. That mechanism authenticates a Zanix-ecosystem SERVICE — identified by a
 * `serviceId` with an asymmetric keypair registered as `JWK_PUB_<serviceId>` — calling ANOTHER
 * service's general API surface, for ANY endpoint, with permissions/rate limits the operator
 * configures per `serviceId`. The trust question here is different in shape: "does this token
 * request genuinely come from the SAME application `GET /oauth/authorize` already redirected a
 * real, authenticated user through" — a question scoped to one specific authorization code, not a
 * general-purpose bearer credential for arbitrary API calls. Requiring an external host to
 * provision and register an RSA keypair just to consume a redirect-based login flow would be a far
 * heavier integration burden than the "register one `client_id`/`client_secret` pair" shape every
 * real-world OAuth2 provider (Google, GitHub, Auth0) actually asks of a third-party application —
 * and would conflate two genuinely different registries (`JWK_PUB_<serviceId>` for internal Zanix
 * services vs. an arbitrary external host's OAuth2 client). A plain, constant-time-compared shared
 * secret (`timingSafeStringEqual`) is the right, minimal, spec-aligned mechanism for this handoff.
 *
 * **Response shape design, spelled out deliberately**: `exchangeCode` returns exactly what
 * `AuthService.issueSessionForSubject` returns — the SAME `{accessToken, refreshToken, expiresAt}`
 * shape every other login flow in this project already returns, not a bespoke envelope. A host's
 * backend that already knows how to consume an iam session (e.g. through this project's own SDK)
 * needs no special-cased parsing for a session obtained through this flow.
 */
@Interactor()
export class OAuthProviderService extends ZanixInteractor {
  /**
   * Starts the flow: validates `client_id`/`redirect_uri` against this instance's own registered
   * clients (`findOAuthProviderClient`/`isRegisteredRedirectUri`) BEFORE any redirect happens, so an
   * unregistered/mismatched `redirect_uri` is rejected outright rather than ever appearing as a
   * `Location` header, then either issues a code and redirects to `redirect_uri` (an active iam
   * session already exists) or bounces the browser through the real hosted login page first.
   *
   * **Session detection reasoning**: this reads the SAME `X-Znx-App-Token` refresh-token cookie
   * `pageSessionGuard` reads for a `@zanix/space` page, via the identical `deriveSessionToken`
   * mechanism — because this endpoint, like any `@zanix/space` page, is reached through a real
   * full-page browser navigation, not a bearer-token SPA call: a plain `GET` redirect can carry
   * cookies but never an `Authorization` header. A missing/invalid/expired session is treated as
   * "not authenticated" (caught, never rethrown) rather than a `401` — the whole point of this
   * branch is to recover by sending the browser to log in, not to fail the request.
   *
   * **Known, deliberate trade-off — no consent screen**: once a session is found, a code is issued
   * and the browser is redirected immediately, with no "continue to `client_id`?" interstitial. This
   * is acceptable ONLY because client registration itself is operator-curated
   * (`OAUTH_PROVIDER_CLIENTS_ENV`), not open self-service signup — the same trust model as a
   * first-party/trusted-partner SSO integration, not a public multi-tenant marketplace of arbitrary
   * third-party apps. A registered client that behaves maliciously (e.g. distributing a phishing
   * link that drives an already-authenticated browser straight through this endpoint) is already a
   * fully identified, operator-trusted party, not an anonymous attacker — but this IS a real,
   * un-mitigated login-CSRF surface against that trust model, and it should be revisited (an
   * explicit consent/continue step) before this endpoint is ever opened to self-service or
   * less-trusted client registration.
   */
  public async authorize(query: OAuthAuthorizeRTO): Promise<Response> {
    const client = findOAuthProviderClient(query.client_id)
    if (!client) {
      throw new HttpError('BAD_REQUEST', { message: 'Unknown OAuth2 client.' })
    }
    if (!isRegisteredRedirectUri(client, query.redirect_uri)) {
      throw new HttpError('FORBIDDEN', {
        message: 'redirect_uri is not registered for this client.',
      })
    }

    const subject = await this.currentSubject()
    if (!subject) {
      return redirectResponse(this.buildLoginRedirect(query), 302)
    }

    const code = await mintAuthorizationCode({
      sub: subject,
      clientId: query.client_id,
      redirectUri: query.redirect_uri,
    })

    const target = new URL(query.redirect_uri)
    target.searchParams.set('code', code)
    if (query.state) target.searchParams.set('state', query.state)
    return redirectResponse(target.toString(), 302)
  }

  /**
   * Exchanges `body.code` for a real session, called by the requesting host's own BACKEND
   * (server-to-server — never a browser, never carrying the end user's iam cookies).
   *
   * Every check below fails closed with the SAME generic `FORBIDDEN` message for every code-related
   * failure shape (expired, replayed, or minted for a different client/redirect URI) — a caller
   * can't fingerprint which specific check failed from the response alone, matching this project's
   * own convention for credential failures (see `AuthService.loginWithPassword`'s own doc).
   *
   * **Single-use enforcement**: `checkTokenBlockList`/`addTokenToBlockList` (`@zanix/auth`) are the
   * SAME blocklist primitives this project's own refresh-token rotation already relies on — reused
   * here for an authorization code's own single-use guarantee rather than a second, parallel
   * mechanism. The check-then-write pair below isn't atomic (the same documented trade-off
   * `@zanix/auth`'s own refresh-token rotation carries), but the code's own 60-second lifetime
   * bounds how long that narrow race window can ever matter.
   *
   * @throws {HttpError} `BAD_REQUEST` when `client_id`/`client_secret` don't match a registered
   *   client. `FORBIDDEN` when `redirect_uri` isn't registered for the client, or `code` is
   *   invalid/expired/already used, or was minted for a different `client_id`/`redirect_uri` than
   *   this request presents.
   */
  public async exchangeCode(body: OAuthTokenExchangeRTO) {
    const client = findOAuthProviderClient(body.client_id)
    if (!client || !timingSafeStringEqual(client.clientSecret, body.client_secret)) {
      throw new HttpError('BAD_REQUEST', { message: 'Invalid client credentials.' })
    }
    if (!isRegisteredRedirectUri(client, body.redirect_uri)) {
      throw new HttpError('FORBIDDEN', {
        message: 'redirect_uri is not registered for this client.',
      })
    }

    const claims = await verifyAuthorizationCode(body.code)
    if (claims.clientId !== body.client_id || claims.redirectUri !== body.redirect_uri) {
      throw new HttpError('FORBIDDEN', { message: 'Invalid or expired authorization code.' })
    }

    const alreadyUsed = await checkTokenBlockList(claims.jti, this.cache)
    if (alreadyUsed) {
      throw new HttpError('FORBIDDEN', { message: 'Invalid or expired authorization code.' })
    }
    await addTokenToBlockList(body.code, this.cache)

    return this.interactors.get(AuthService).issueSessionForSubject(claims.sub)
  }

  /** The current request's already-authenticated subject (an `auth` record id), or `undefined`
   * when no valid iam session cookie is present — see `authorize`'s own doc for why a verification
   * failure here is swallowed rather than propagated. */
  private async currentSubject(): Promise<string | undefined> {
    try {
      const derived = await deriveSessionToken(this.context, undefined, { cache: this.cache })
      return derived.payload.sub as string | undefined
    } catch {
      return undefined
    }
  }

  /**
   * Builds the `/{lang}/login?redirect_to=...` target that sends an unauthenticated browser through
   * the real hosted login page and back to THIS SAME authorization request afterward.
   *
   * Two existing mechanisms are reused here unchanged, not reinvented: `REDIRECT_TO_PARAM`/
   * `resolvePostLoginRedirect`'s open-redirect-safe mechanism (`utils/constants.ts`) — `/oauth/
   * authorize?...` is a same-origin relative path, which `isSafeRedirectTarget` already accepts
   * unconditionally, with no `TRUSTED_REDIRECT_ORIGINS` entry — and `DEFAULT_LANG`
   * (`space/constants.ts`), required because `/login` is itself one of `middleware.ts`'s own
   * `REST_CONTROLLER_PREFIXES`: `langPreHandler` deliberately never rewrites a request under that
   * prefix, so a bare, unprefixed `/login` here would NOT be redirected to the real
   * `/{lang}/login` page the way an ordinary Space link is — this builds the already-prefixed path
   * directly instead. It always uses `DEFAULT_LANG`, never the caller's own lang preference (a
   * cookie/`Accept-Language`) — correct while `AVAILABLE_LANGS` has a single entry; adding a
   * language requires resolving the caller's preference here the way `langPreHandler` does.
   *
   * The query is rebuilt from the already-validated `query` fields rather than re-reading the raw
   * request URL, so this can never carry through anything `OAuthAuthorizeRTO` itself didn't already
   * accept.
   */
  private buildLoginRedirect(query: OAuthAuthorizeRTO): string {
    const params = new URLSearchParams({
      client_id: query.client_id,
      redirect_uri: query.redirect_uri,
      response_type: query.response_type,
    })
    if (query.state) params.set('state', query.state)
    const returnTo = `${REST_API_PREFIX}/oauth/authorize?${params.toString()}`
    return `/${DEFAULT_LANG}/login?${REDIRECT_TO_PARAM}=${encodeURIComponent(returnTo)}`
  }
}
