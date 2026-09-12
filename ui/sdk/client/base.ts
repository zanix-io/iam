import { RestClient, SESSION_HEADERS } from '@zanix/server'

/** Construction options every {@link IamApiClient} subclass accepts. */
export interface IamApiClientOptions {
  /** `iam`'s own deployment base URL (e.g. `https://iam.example.com`) — no trailing slash
   * required, `RestClient` normalizes it. */
  baseUrl: string
}

/**
 * Base class every flow-specific `iam` client (`LoginClient`, `OtpClient`, `TotpClient`,
 * `PasswordClient`) extends — a thin `@zanix/server` `RestClient` bound to `iam`'s own base URL,
 * with nothing else configured. `RestClient` works standalone outside any Zanix app/server runtime
 * (it falls back to an in-process cache when no `'cache:local'` core connector is registered, and
 * its own constructor needs no decoration) — safe to construct directly in a browser or any other
 * plain JavaScript environment.
 */
export abstract class IamApiClient extends RestClient {
  constructor(options: IamApiClientOptions) {
    super({ baseUrl: options.baseUrl, autoInitialize: false })
  }

  /** Builds the `Authorization: Bearer <accessToken>` header `iam` expects on every endpoint that
   * requires an authenticated session (see `AuthTokenValidation()` on the real handler). */
  protected authHeaders(accessToken: string): Record<string, string> {
    return { Authorization: `Bearer ${accessToken}` }
  }

  /**
   * Carries `refreshToken` via the SAME `X-Znx-App-Token` header/cookie name `@zanix/auth`'s own
   * session-cookie convention already uses (`SESSION_HEADERS.user.token`, `@zanix/server`) — NOT
   * an `iam`-specific header. `POST /login/refresh` accepts the token in its JSON body already;
   * this is purely ADDITIONAL, so `iam`'s own `refreshRateLimitIdentityGuard` can key that
   * endpoint's rate limit by this token's real subject instead of your caller's own IP — the
   * difference that matters if you proxy refresh calls through your own backend on behalf of many
   * end users (see `docs/consuming-iam.md`'s "Rate limiting" section). Harmless to include on any
   * other request; `iam` only reads it where it actually matters.
   */
  protected refreshIdentityHeaders(refreshToken: string): Record<string, string> {
    return { [SESSION_HEADERS.user.token as string]: refreshToken }
  }
}
