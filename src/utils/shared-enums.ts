/**
 * @module
 *
 * Plain, dependency-free enum-shaped constants needed by BOTH server code (`utils/constants.ts`
 * re-exports every one of these, unchanged, for that side) and browser-safe `ui/` code — kept in
 * their own leaf file, with zero imports of its own, so a browser-safe SDK/component can import
 * this file's own public `./shared-enums` subpath directly, never through `"."` (→ `mod.ts`, which
 * runs `Zanix.start()` as a side effect the instant it's imported). `utils/constants.ts` itself
 * carries `Deno.env` reads and an eager config-validation throw, so these values live here instead
 * to keep this subpath side-effect-free.
 */

/** OAuth2 providers this project wires (see `auth.app.ts`'s manifest resources). */
export const OAUTH_PROVIDERS = ['google', 'github'] as const

/**
 * Delivery channels `@zanix/auth`'s OTP mechanism can dispatch a one-time code through — matches
 * `@zanix/notifications`'s own `Notifiers` union exactly, so every value here is a real,
 * independently-registerable channel (`SmtpClient`/`SmsClient`/`WhatsappClient`), not aspirational.
 */
export const NOTIFIERS = ['email', 'sms', 'whatsapp'] as const

/**
 * Every supported second-factor method — the delivery-based `NOTIFIERS` (OTP) plus the
 * authenticator-app method (`'totp'`, no delivery involved — the code is generated locally on
 * the user's device from a shared secret).
 */
export const TWO_FACTOR_METHODS = [...NOTIFIERS, 'totp'] as const
