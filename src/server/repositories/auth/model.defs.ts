import {
  dataPoliciesGetter,
  registerModel,
  type RequiredDecryptableScalar,
  type RequiredUnmaskableScalar,
  type RequiredVerifiableScalar,
  Schema,
} from '@zanix/datamaster'
import { LOGIN_ACTIONS, OAUTH_PROVIDERS, TWO_FACTOR_METHODS } from 'utils/constants.ts'
import seeders from './seeders/main.ts'

/**
 * The `auth` collection's own persisted shape — credentials and session-lifecycle state, kept
 * separate from the future `users` collection's profile data (a later, not-yet-built slice).
 *
 * This model's own `_id` is the Mongoose-default `Schema.Types.ObjectId`-typed field (no override
 * below), so every seeded/inserted `id`/`_id` value here must be a real 24-character hex ObjectId
 * — there's no exception for this collection.
 *
 * `userId` is a generic foreign-key reference to that future `users` collection — declared here
 * (matching `grant-access`'s own real precedent of referencing `roles`/`users` generically before
 * those slices exist) without a `ref: 'users'` populate ever being exercised until that slice
 * registers the `users` model. `email`/`phone` are denormalized directly onto this record
 * (rather than only living on `users`, as a real, deployed sibling project does) so THIS slice's
 * own login/recovery/OTP/TOTP flows — including SMS/WhatsApp delivery, which needs a real phone
 * number — are fully self-contained before `users` exists.
 *
 * `email` is stored MASKED (`dataPoliciesGetter({ protection: 'mask' })`), the same real, deployed
 * sibling project's own precedent for this exact field — paired with `emailKeyId`, a separate,
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
  /** E.164 phone number, required only to receive an `sms`/`whatsapp` `NOTIFIERS` dispatch. */
  phone?: string
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
  /** Generic reference to a future `roles` collection — see `userId`'s own doc above. */
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
