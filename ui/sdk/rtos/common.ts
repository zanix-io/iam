/**
 * @module
 *
 * Shared request/response shapes reused across more than one login/2FA/password-recovery flow —
 * kept separate from `login.ts`/`password.ts` (which each mirror one real `iam` RTO file
 * one-to-one) since these have no single real-file counterpart of their own.
 *
 * A type mirrored from `@zanix/auth`'s own public shape (e.g. `SessionTokens` below) stays
 * mirrored, not re-exported, on purpose — reaching for that package's real type would add a
 * runtime dependency this SDK doesn't otherwise need, beyond `@zanix/validator`/`@zanix/server`'s
 * `RestClient`. An enum-shaped constant that's genuinely `iam`'s own (`OAUTH_PROVIDERS` below) has
 * no such reason to stay mirrored — it imports the real value from `utils/shared-enums.ts`'s own
 * public `./shared-enums` subpath, a leaf module with zero imports of its own, carved out
 * specifically so a browser-safe SDK can reach it without going through `"."` (→ `mod.ts`, which
 * runs `Zanix.start()` as a side effect the instant it's imported).
 */
import { OAUTH_PROVIDERS } from 'utils/shared-enums.ts'

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
 * The three OAuth2 providers `iam` can be configured for — the real `utils/shared-enums.ts`
 * tuple, re-exported here for this SDK's own callers. A given deployment may have zero, one, or
 * both configured — a consumer's UI should only render a "Continue with…" option for a provider
 * its own backend actually resolves.
 */
export { OAUTH_PROVIDERS }

/** One of {@link OAUTH_PROVIDERS}. */
export type OauthProvider = typeof OAUTH_PROVIDERS[number]

/** A generic, human-readable dispatch/action confirmation — the shape most non-session `iam`
 * endpoints in this SDK's scope return (an OTP send, a logout, a TOTP-confirm). */
export interface MessageResponse {
  /** A short, human-readable confirmation (e.g. `'notification sent'`). */
  response: string
}
