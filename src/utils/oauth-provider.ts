import { HttpError, InternalError } from '@zanix/errors'
import { createJWT, JWT_KEY_ENV, verifyJWT } from '@zanix/auth'

/**
 * Env var name for this instance's registered OAuth2-provider clients — the hosts allowed to
 * redirect an end user to `GET /oauth/authorize` and later exchange the resulting code for a
 * session at `POST /oauth/token` (`OAuthProviderService`). A JSON array of
 * `{clientId, clientSecret, redirectUris}` objects — the same "one env var, JSON value" shape
 * {@linkcode THEME_ENV}/{@linkcode MESSAGES_ENV} already establish (`utils/constants.ts`). Unset
 * means no client is registered — `/oauth/authorize` rejects every request until at least one is
 * configured.
 *
 * A static, env-var-driven allowlist, not a database-backed model: this mirrors how this project
 * already registers its OWN OAuth2 connectors
 * (`GOOGLE_OAUTH2_CLIENT_ID_ENV`/`GITHUB_OAUTH2_CLIENT_ID_ENV`, see `auth.app.ts`) and costs
 * nothing extra to operate for the small, operator-curated set of hosts this tier targets — adding,
 * removing, or rotating a client's secret is an env change and a redeploy, with no self-service
 * registration endpoint of its own. A `grant-access`-style database-backed repository (its own
 * model, admin CRUD endpoints) is the upgrade path for a deployment that needs runtime client
 * management instead.
 */
export const OAUTH_PROVIDER_CLIENTS_ENV = 'OAUTH_PROVIDER_CLIENTS'

/** One registered OAuth2-provider client — see {@linkcode OAUTH_PROVIDER_CLIENTS_ENV}. */
export type OAuthProviderClient = {
  /** The value this client sends as `client_id` on `GET /oauth/authorize` and `POST /oauth/token`. */
  clientId: string
  /** The shared secret this client presents at `POST /oauth/token` to prove the exchange request
   * genuinely comes from its own backend — see {@linkcode timingSafeStringEqual}'s own doc for how
   * this is compared. Generated and rotated by the operator registering the client; this project
   * never generates or displays one. */
  clientSecret: string
  /** The exact redirect URIs this client is allowed to receive a code (or the login bounce-back) at
   * — see {@linkcode isRegisteredRedirectUri}'s own doc for why membership here must be a
   * byte-for-byte match. */
  redirectUris: string[]
}

/**
 * Parses {@linkcode OAUTH_PROVIDER_CLIENTS_ENV} into the real client list — `[]` when unset, so a
 * deployment that never configures this tier sees `/oauth/authorize` reject every request with a
 * plain "unknown client" error instead of a boot-time failure. A malformed value throws eagerly —
 * the same fail-loud posture `resolveThemeOverrides`/`resolveMessageOverrides` already apply to
 * their own JSON env vars (`utils/constants.ts`) — since a typo here would otherwise silently
 * strand every host this instance is supposed to serve.
 */
export function resolveOAuthProviderClients(): OAuthProviderClient[] {
  const raw = Deno.env.get(OAUTH_PROVIDER_CLIENTS_ENV)
  if (!raw) return []
  try {
    return JSON.parse(raw) as OAuthProviderClient[]
  } catch {
    throw new InternalError(`${OAUTH_PROVIDER_CLIENTS_ENV} must be valid JSON — got: "${raw}"`, {
      code: 'IAM_INVALID_OAUTH_PROVIDER_CLIENTS',
    })
  }
}

/** Looks up a registered client by `clientId` — `undefined` when no client with that id is
 * configured at all. */
export function findOAuthProviderClient(clientId: string): OAuthProviderClient | undefined {
  return resolveOAuthProviderClients().find((client) => client.clientId === clientId)
}

/**
 * Whether `redirectUri` is one of `client`'s own registered redirect URIs, compared byte-for-byte.
 * Exact match only, never a prefix or same-origin check: a redirect URI is where this project hands
 * off a real authorization code, so accepting anything looser would let a legitimately registered
 * client's own trust be reused against an attacker-controlled path on the same origin (a classic
 * open-redirect-via-registered-client shape) — the same exact-match requirement a real OAuth2
 * authorization server always applies to this check.
 */
export function isRegisteredRedirectUri(
  client: OAuthProviderClient,
  redirectUri: string,
): boolean {
  return client.redirectUris.includes(redirectUri)
}

/**
 * The `aud` claim every authorization code carries, and the one {@linkcode verifyAuthorizationCode}
 * requires back. A plain, fixed defense-in-depth marker so a code JWT can never be verified as (or
 * replayed as) a real session token, even though both happen to be signed with the same
 * {@linkcode JWT_KEY_ENV} secret — `verifyJWT`'s own `aud` check rejects a token minted for any
 * other audience outright.
 */
const OAUTH_CODE_AUDIENCE = 'iam:oauth-code'

/**
 * How long a minted authorization code stays valid, in seconds — long enough to cover the browser's
 * own round trip back to the host's redirect URI (including, on a first visit, the real login form
 * submission in between), short enough to keep a leaked code's own exposure window small. The same
 * order of magnitude real OAuth2 providers use for this exact grant.
 */
const OAUTH_CODE_EXPIRATION_SECONDS = 60

/** The claims a minted authorization code carries — verified back in full by
 * {@linkcode verifyAuthorizationCode} before a code is ever exchanged for a session. */
export type OAuthCodeClaims = {
  /** The `auth` record id (`AuthenticationAttrs.id`) this code authenticates — the same value
   * `AuthService`'s own session tokens carry as `sub`. */
  sub: string
  /** The `client_id` this code was minted for — re-checked at exchange time against the token
   * request's own `client_id`, not just trusted from the code alone. */
  clientId: string
  /** The `redirect_uri` this code was minted for — re-checked at exchange time the same way. */
  redirectUri: string
}

/**
 * Mints a short-lived, single-use authorization code for an already-authenticated `claims.sub` —
 * binding it to the exact `clientId`/`redirectUri` pair `OAuthProviderService.authorize` already
 * validated, so {@linkcode verifyAuthorizationCode}'s own caller can reject a code redeemed for a
 * different client or a different redirect URI than the one it was actually issued for. Signed with
 * the same HMAC secret ({@linkcode JWT_KEY_ENV}) this project's own session tokens use —
 * `createJWT`'s own generated `jti` doubles as the code's single-use identity for the blocklist a
 * redeeming caller checks separately (this function never touches the blocklist itself, since doing
 * so needs a cache provider it has no access to).
 *
 * @throws {HttpError} `INTERNAL_SERVER_ERROR` when {@linkcode JWT_KEY_ENV} isn't configured.
 */
export function mintAuthorizationCode(claims: OAuthCodeClaims): Promise<string> {
  const secret = requireJwtKey()
  return createJWT({ ...claims, aud: OAUTH_CODE_AUDIENCE }, secret, {
    expiration: OAUTH_CODE_EXPIRATION_SECONDS,
  })
}

/**
 * Verifies `code` — signature, expiration, and the {@linkcode OAUTH_CODE_AUDIENCE} marker — and
 * returns its embedded claims plus its `jti` (for the caller's own single-use replay check).
 * Deliberately does NOT check replay itself (the caller's own blocklist check owns that — it needs
 * a cache provider this pure function has no access to) or whether `clientId`/`redirectUri` match
 * the CURRENT exchange request (the caller compares those against what it already validated).
 *
 * @throws {HttpError} `FORBIDDEN` when `code` is malformed, expired, or its signature/audience
 *   doesn't verify — one generic message for every failure shape, so a caller can't fingerprint
 *   which specific check failed from the response alone.
 */
export async function verifyAuthorizationCode(
  code: string,
): Promise<OAuthCodeClaims & { jti: string }> {
  const secret = requireJwtKey()
  try {
    const payload = await verifyJWT(code, secret, { aud: OAUTH_CODE_AUDIENCE })
    return {
      sub: payload.sub as string,
      clientId: payload.clientId as string,
      redirectUri: payload.redirectUri as string,
      jti: payload.jti as string,
    }
  } catch {
    throw new HttpError('FORBIDDEN', { message: 'Invalid or expired authorization code.' })
  }
}

/** Resolves {@linkcode JWT_KEY_ENV} or fails loudly — the same secret this project's own session
 * tokens are signed with, reused here rather than provisioning a second HMAC key for one narrow
 * purpose. */
function requireJwtKey(): string {
  const secret = Deno.env.get(JWT_KEY_ENV)
  if (!secret) {
    throw new InternalError(`Missing required JWT key in environment variables: ${JWT_KEY_ENV}.`, {
      code: 'IAM_MISSING_JWT_KEY',
    })
  }
  return secret
}

/**
 * Constant-time string comparison for a client secret — a plain `===` returns as soon as the first
 * differing byte is found, so its response time leaks how many leading bytes of a guess were
 * correct. Rejects immediately on a length mismatch (leaking only the length itself, the same
 * accepted trade-off every constant-time compare makes — Deno's own `@std/crypto`
 * `timingSafeEqual` included) before comparing every remaining byte with no early exit.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const bytesA = new TextEncoder().encode(a)
  const bytesB = new TextEncoder().encode(b)
  if (bytesA.length !== bytesB.length) return false

  let diff = 0
  for (let i = 0; i < bytesA.length; i++) diff |= bytesA[i] ^ bytesB[i]
  return diff === 0
}
