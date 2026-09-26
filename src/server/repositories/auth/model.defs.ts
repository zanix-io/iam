import {
  dataPoliciesGetter,
  registerModel,
  type RequiredDecryptableScalar,
  type RequiredUnmaskableScalar,
  type RequiredVerifiableScalar,
  Schema,
} from '@zanix/datamaster'
import { LOGIN_ACTIONS, NOTIFIERS, OAUTH_PROVIDERS, TWO_FACTOR_METHODS } from 'utils/constants.ts'
import seeders from './seeders/main.ts'

/**
 * The `auth` collection's own persisted shape — credentials and session-lifecycle state, kept
 * separate from the `users` collection's profile data (see `../users/model.defs.ts`).
 *
 * This model's own `_id` is the Mongoose-default `Schema.Types.ObjectId`-typed field (no override
 * below), so every seeded/inserted `id`/`_id` value here must be a real 24-character hex ObjectId
 * — there's no exception for this collection.
 *
 * `userId` references the linked `users` profile (optional — see
 * `UsersRepository.assertActive`). `email`/`phone` live on this record rather than on `users`, so
 * the login/recovery/OTP/TOTP flows — including SMS/WhatsApp delivery, which needs a real phone
 * number — are self-contained in the `auth` collection.
 *
 * `email` is stored MASKED (`dataPoliciesGetter({ protection: 'mask' })`) — paired with
 * `emailKeyId`, a separate,
 * deterministic SHA-256 digest of the plaintext (see `email-key.ts`'s own doc) that `findByEmail`
 * actually queries against, since a masked value isn't directly equality-queryable on its own.
 * `emailKeyId` — not `email` — carries the real `unique` index for exactly that reason: a
 * uniqueness constraint on the masked value would be meaningless (or actively wrong) once masking
 * is salted per-record, while the deterministic digest still uniquely identifies the same
 * plaintext every time.
 *
 * Deliberately no `tenantId` here, unlike `RolesAttrs`/`GrantAccessAttrs`: this project serves
 * exactly ONE product per deployment, so `email` below stays a plain, globally-unique identity —
 * there is only ever one product's worth of accounts to disambiguate. `roles`/`grant-access` carry
 * an optional `tenantId` for a different reason entirely — partitioning that ONE product's own
 * customers/organizations from each other (see `RolesAttrs`'s own doc, `../roles/model.defs.ts`)
 * — not for isolating unrelated products. Making `auth`/`users` multi-PRODUCT (an Auth0/Okta-shaped
 * identity-provider-as-a-service, several unrelated products sharing one deployment) is a
 * structurally bigger redesign this project doesn't take on: it would also need per-product OAuth2
 * redirect URIs, per-product notification templates, per-product-scoped JWT `aud`/`iss` claims, and
 * a tenant-scoped `RBAC_PERMISSIONS` catalog (currently a global constant, `utils/constants.ts`) —
 * not a change this model's own `email` index could carry alone. This asymmetry with
 * `roles`/`grant-access` is deliberate, not an oversight.
 */
export type AuthenticationAttrs = {
  id: string
  userId?: string
  email: string
  /** Deterministic SHA-256 digest of `email` (see `email-key.ts`) — the real, indexed lookup key,
   * since `email` itself is stored masked and isn't directly equality-queryable. Always set by
   * `AuthRepository.registerAuth`/its own seeders; never set by a caller directly. */
  emailKeyId: string
  /** E.164 phone number, required only to receive an `sms`/`whatsapp` `NOTIFIERS` dispatch. Set
   * exclusively by `AuthService.phoneConfirm` — only once a real OTP sent to this exact number has
   * been verified (`AuthService.phoneEnroll`'s own doc), never trusted from a plain settings edit. */
  phone?: string
  /** Which channel a passwordless OTP-login code (`PasswordService.recovery`, `isLogin: true`)
   * gets delivered through, when the caller doesn't already force one (a real 2FA challenge always
   * does — see `AuthService.finishLogin`). `undefined` means "email", the default — never stored
   * explicitly as `'email'` itself.
   * Deliberately NOT `twoFactorAuthConfig.method`, even though both draw from the same `NOTIFIERS`
   * set: this is a delivery-channel PREFERENCE for the one-and-only login code a passwordless
   * attempt already sends, never a second, additional factor — choosing `'sms'` here must never
   * cause a code to go out on `'email'` too, or vice versa. Only ever `'sms'`/`'whatsapp'` when
   * `phone` is already set (`AuthService.setOtpNotifier`'s own invariant, enforced there, not by
   * this schema). */
  otpNotifier?: Exclude<typeof NOTIFIERS[number], 'email'>
  password?: string
  mustChangePassword?: boolean
  /** Second-factor requirement — `method: 'totp'` never carries a `NOTIFIERS` delivery channel. */
  twoFactorAuthConfig?: {
    method: typeof TWO_FACTOR_METHODS[number]
    triggerOn: typeof LOGIN_ACTIONS[number][]
  }
  /** TOTP shared secret, persisted only after `AuthService.totpConfirm` verifies enrollment. */
  totpSecret?: string
  oauthProvider?: typeof OAUTH_PROVIDERS[number]
  oauthRefreshToken?: string
  /** The assigned `roles` document — see `RolesService.assignRole`. Unset means no permissions. */
  roleId?: string
  lastLoginAt?: Date
  createdAt: Date
  updatedAt: Date
}

/** `AuthenticationAttrs` with its protected fields resolved to their real, hydrated accessors. */
export type HydratedAuth =
  & Omit<
    AuthenticationAttrs,
    'password' | 'oauthRefreshToken' | 'totpSecret' | 'phone' | 'email'
  >
  & {
    password?: RequiredVerifiableScalar
    oauthRefreshToken?: RequiredDecryptableScalar
    totpSecret?: RequiredDecryptableScalar
    phone?: RequiredUnmaskableScalar
    email: RequiredUnmaskableScalar
  }

const TwoFactorAuthConfigSchema = new Schema({
  method: {
    type: String,
    enum: TWO_FACTOR_METHODS,
    required: true,
  },
  triggerOn: {
    type: [String],
    enum: LOGIN_ACTIONS,
    required: true,
  },
})

registerModel<AuthenticationAttrs>({
  name: 'auth',
  definition: {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'users',
    },
    email: {
      type: String,
      required: true,
      get: dataPoliciesGetter({ access: 'private', protection: 'mask' }),
    },
    emailKeyId: {
      type: String,
      required: true,
      unique: true,
    },
    phone: {
      type: String,
      get: dataPoliciesGetter({ access: 'internal', protection: 'mask' }),
    },
    otpNotifier: {
      type: String,
      enum: NOTIFIERS.filter((notifier) => notifier !== 'email'),
    },
    roleId: {
      type: Schema.Types.ObjectId,
      ref: 'roles',
    },
    twoFactorAuthConfig: TwoFactorAuthConfigSchema,
    password: {
      type: String,
      get: dataPoliciesGetter({ access: 'internal', protection: 'hash' }),
    },
    mustChangePassword: Boolean,
    totpSecret: {
      type: String,
      get: dataPoliciesGetter({ access: 'internal', protection: 'encrypt' }),
    },
    oauthProvider: {
      type: String,
      enum: OAUTH_PROVIDERS,
    },
    oauthRefreshToken: {
      type: String,
      get: dataPoliciesGetter({ access: 'internal', protection: 'encrypt' }),
    },
    lastLoginAt: Date,
  },
  extensions: {
    seeders,
  },
  options: {
    timestamps: true,
  },
})
