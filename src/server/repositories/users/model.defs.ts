import {
  dataPoliciesGetter,
  registerModel,
  type RequiredUnmaskableScalar,
  Schema,
} from '@zanix/datamaster'
import { USER_STATUS } from 'utils/constants.ts'
import seeders from './seeders/main.ts'

/**
 * The `users` collection's own persisted shape — profile data only, deliberately carrying no
 * `email`/credentials of its own. `auth/model.defs.ts` already owns `email` as the required,
 * unique, directly-queryable login key (unprotected there, by design, for `findByEmail`); mirroring
 * it here too — as the real, deployed sibling project this domain slice is grounded on does, paired
 * with a separate `keyId` hash field purely to make a masked `email` searchable — would give this
 * project TWO independently-updatable copies of the same PII with no functional need for it, a
 * real drift risk this slice deliberately avoids by keeping `email` singly owned on `auth`. A
 * profile is reached FROM its `auth` record via `AuthenticationAttrs.userId` (the direction that
 * slice already declared and tested) — never the reverse — so this model carries no back-reference
 * to `auth` either.
 */
export type UsersAttrs = {
  id: string
  firstName?: string
  lastName?: string
  /** Contact phone — independent of `auth.phone` (that one exists solely for SMS/WhatsApp OTP delivery). */
  phoneNumber?: string
  /**
   * `'ACTIVE'` by default for both an admin-registered and an OAuth2-auto-provisioned account.
   * `'INACTIVE'`/`'DELETED'` are set only via the admin edit-by-id endpoint (see
   * `EDITABLE_USER_STATUS`) and gate every login/session-refresh/recovery path in
   * `AuthService`/`PasswordService` — see those files' own `UsersRepository.assertActive` calls.
   */
  status: UserStatus
  /** The `users.id` of the admin who registered this account, when created via `registerUser`. */
  createdBy?: string
  createdAt: Date
  updatedAt: Date
}

/** `UsersAttrs` with its protected fields resolved to their real, hydrated accessors. */
export type HydratedUsers = Omit<UsersAttrs, 'phoneNumber'> & {
  phoneNumber?: RequiredUnmaskableScalar
}

registerModel<UsersAttrs>({
  name: 'users',
  definition: {
    firstName: String,
    lastName: String,
    phoneNumber: {
      type: String,
      get: dataPoliciesGetter({ access: 'internal', protection: 'mask' }),
    },
    status: {
      type: String,
      enum: USER_STATUS,
      default: 'ACTIVE',
      required: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'users',
    },
  },
  extensions: {
    seeders,
  },
  options: {
    timestamps: true,
  },
})
