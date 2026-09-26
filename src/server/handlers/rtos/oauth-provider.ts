import { BaseRTO, IsEnum, IsString, IsUrl } from '@zanix/validator'

/**
 * `GET /oauth/authorize` query — the standard OAuth2 authorization-code request (RFC 6749
 * §4.1.1). Field names stay in their real, spec-fixed wire format (`snake_case`), never this
 * project's own `camelCase` convention: an external host's OAuth2 client library builds this exact
 * query string unaware of any Zanix-specific naming convention, the same reasoning
 * `GoogleUserInfo`/`GitHubUserInfo` (`@zanix/auth`) already apply to a provider's own external
 * response shape.
 */
export class OAuthAuthorizeRTO extends BaseRTO {
  /** The requesting host's own registered client identifier — see `utils/oauth-provider.ts`'s own
   * `OAUTH_PROVIDER_CLIENTS_ENV`. */
  @IsString({ expose: true })
  accessor client_id!: string

  /** Where the authorization code (or the login bounce-back) is delivered — must exactly match one
   * of `client_id`'s own registered redirect URIs; see `isRegisteredRedirectUri`'s own doc for why
   * this is never a looser prefix/origin check. */
  @IsUrl({ expose: true })
  accessor redirect_uri!: string

  /** Only the authorization-code grant is accepted — this project's OAuth2 connectors never use
   * the weaker implicit flow on the CONSUMER side either, and the PROVIDER role follows the same
   * preference. */
  @IsEnum(['code'], { expose: true })
  accessor response_type!: 'code'

  /** An opaque value the requesting host generated for its OWN CSRF protection — relayed back
   * UNCHANGED on the redirect to `redirect_uri`, never inspected or verified by this project:
   * `state` is the REQUESTING CLIENT's own round-trip token (RFC 6749 §10.12), not this
   * authorization server's to validate. */
  @IsString({ expose: true, optional: true })
  accessor state: string | undefined
}

/**
 * `POST /oauth/token` body — the authorization-code grant's token-exchange request (RFC 6749
 * §4.1.3), called by the requesting host's own BACKEND (server-to-server, no browser/cookies
 * involved) to trade a code minted by `OAuthAuthorizeRTO`'s own endpoint for a real session. Same
 * spec-fixed wire-format naming as `OAuthAuthorizeRTO` above.
 */
export class OAuthTokenExchangeRTO extends BaseRTO {
  /** Only the authorization-code grant is supported — see `OAuthAuthorizeRTO.response_type`'s own
   * doc for why this project never implements a weaker grant type. */
  @IsEnum(['authorization_code'], { expose: true })
  accessor grant_type!: 'authorization_code'

  /** The single-use authorization code minted by `GET /oauth/authorize`. */
  @IsString({ expose: true })
  accessor code!: string

  /** Must match the `client_id` the code was originally minted for. */
  @IsString({ expose: true })
  accessor client_id!: string

  /** This client's own registered secret — proves this request genuinely comes from the host's
   * backend, not a party that merely observed the authorization code in transit (a browser history
   * entry, a `Referer` header, a server access log). */
  @IsString({ expose: true })
  accessor client_secret!: string

  /** Must exactly match the `redirect_uri` the code was originally minted for — see
   * `OAuthProviderService.exchangeCode`'s own doc for why this is checked again here, not only at
   * `/oauth/authorize`. */
  @IsUrl({ expose: true })
  accessor redirect_uri!: string
}
