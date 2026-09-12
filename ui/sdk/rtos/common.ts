/**
 * @module
 *
 * Shared request/response shapes reused across more than one login/2FA/password-recovery flow —
 * kept separate from `login.ts`/`password.ts` (which each mirror one real `iam` RTO file
 * one-to-one) since these have no single real-file counterpart of their own.
 *
 * Mirrored, not re-exported, from their real sources: `iam`'s own `deno.json` `exports` map
 * carries only `"."` → `mod.ts`, which runs `Zanix.start()` as a side effect the instant it's
 * imported — there is no subpath a browser-safe SDK could import these from without triggering
 * that bootstrap. See `deno-lazy-dependency-pattern`'s "interim local type" guidance for the same
 * reasoning applied here. Kept narrow (only the fields a consumer actually needs), not a full
 * mirror of either source's own internals.
 */

/**
 * A successful login/refresh/recovery response's session tokens — mirrors `@zanix/auth`'s public
 * `SessionTokens` type (`accessToken`/`refreshToken`, both signed JWTs) rather than re-exporting it
 * directly, so this SDK depends on nothing beyond `@zanix/validator`/`@zanix/server`'s `RestClient`
 * for its own runtime footprint.
 */
export interface SessionTokens {
  /** Short-lived token to send as `Authorization: Bearer <accessToken>` on an authenticated call. */
  accessToken: string
  /** Long-lived token to exchange for a new token pair via {@link LoginClient.refresh}. */
  refreshToken: string
}

/**
 * The three OAuth2 providers `iam` can be configured for — mirrors `utils/constants.ts`'s own
 * `OAUTH_PROVIDERS` tuple (not reachable from a public subpath, same reasoning as this module's own
 * header doc). A given deployment may have zero, one, or both configured — a consumer's UI should
 * only render a "Continue with…" option for a provider its own backend actually resolves.
 */
export const OAUTH_PROVIDERS = ['google', 'github'] as const

/** One of {@link OAUTH_PROVIDERS}. */
export type OauthProvider = typeof OAUTH_PROVIDERS[number]

/** A generic, human-readable dispatch/action confirmation — the shape most non-session `iam`
 * endpoints in this SDK's scope return (an OTP send, a logout, a TOTP-confirm). */
export interface MessageResponse {
  response: string
}
