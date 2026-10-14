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

/**
 * The `typ` claim of a step-up token. Together with {@linkcode STEP_UP_TOKEN_AUDIENCE} it tells a
 * step-up token apart from every other token signed with the same key, so a verifier rejects any
 * token that does not carry both.
 */
export const STEP_UP_TOKEN_TYPE = 'step-up'

/** The `aud` claim of a step-up token. No role or permission code uses it, so a token carrying it
 * satisfies no permission requirement. */
export const STEP_UP_TOKEN_AUDIENCE = 'iam:step-up'

/** The second factors a step-up can ask for: the user's authenticator app (`'totp'`) or a
 * one-time code sent through their configured notifier (`'otp'`). */
export const STEP_UP_METHODS = ['totp', 'otp'] as const

/** The shape of a step-up `purpose`: 1 to 64 lowercase letters, digits and hyphens. */
export const STEP_UP_PURPOSE_REGEX = /^[a-z0-9-]{1,64}$/

/** The shape of a step-up `bind` value: 1 to 256 printable ASCII characters. */
export const STEP_UP_BIND_REGEX = /^[\x20-\x7E]{1,256}$/

/** The `purpose` of the step-up that authorizes changing or removing a second factor or a
 * credential of the signed-in account. `iam` itself requires the resulting token on the operations
 * of {@linkcode FACTOR_CHANGE_OPERATIONS}. */
export const FACTOR_CHANGE_PURPOSE = 'factor-change'

/**
 * The operations that require a `factor-change` step-up token, each also the token's `bind` value
 * so a token proves exactly one operation:
 *
 * - `totp-confirm`: `POST /login/totp/confirm`.
 * - `totp-disable`: `DELETE /login/totp`.
 * - `phone-confirm`: `POST /login/phone/confirm`.
 * - `phone-disable`: `DELETE /login/phone`.
 * - `otp-notifier`: `POST /login/otp-notifier`.
 * - `password-change`: `POST /pwd/change`.
 * - `password-add`: `POST /pwd/add`.
 * - `password-remove`: `DELETE /pwd/remove`.
 * - `totp-backup-codes`: `POST /login/totp/backup-codes`.
 */
export const FACTOR_CHANGE_OPERATIONS = [
  'totp-confirm',
  'totp-disable',
  'phone-confirm',
  'phone-disable',
  'otp-notifier',
  'password-change',
  'password-add',
  'password-remove',
  'totp-backup-codes',
] as const

/** One of {@linkcode FACTOR_CHANGE_OPERATIONS}. */
export type FactorChangeOperation = typeof FACTOR_CHANGE_OPERATIONS[number]

/** The request header that carries the `factor-change` step-up token to the operations of
 * {@linkcode FACTOR_CHANGE_OPERATIONS}. */
export const STEP_UP_TOKEN_HEADER = 'X-Znx-Step-Up-Token'
