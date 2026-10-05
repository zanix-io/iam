import { BaseRTO, IsEmail, IsEnum, IsObjectID, IsPhone, IsString } from '@zanix/validator'
import { SearchPaginationRTO } from '@zanix/datamaster'
import { EDITABLE_USER_STATUS, USER_STATUS } from 'utils/constants.ts'
import { IsLookupEmail } from './validations/is-lookup-email.ts'

/** Shared profile fields — self-service update and the admin edit-by-id endpoint both extend this. */
export class UserProfileRTO extends BaseRTO {
  @IsString({ expose: true, optional: true })
  accessor firstName: string | undefined

  @IsString({ expose: true, optional: true })
  accessor lastName: string | undefined

  @IsPhone({ expose: true, optional: true })
  accessor phoneNumber: string | undefined
}

/**
 * `POST /users/register` body — administrative registration only (see `UsersController`'s own
 * doc, no public self-signup endpoint exists). `password` is optional: when omitted, the new
 * account is invited to set its own via the existing password-recovery flow instead of an admin
 * choosing/knowing it (see `UsersService.registerUser`).
 */
export class UserRegisterRTO extends UserProfileRTO {
  @IsEmail({ expose: true })
  accessor email!: string

  @IsString({ expose: true, optional: true })
  accessor password: string | undefined
}

/** `PATCH /users/:id` body — admin profile edit, plus the only status transitions it may make. */
export class AdminEditUserRTO extends UserProfileRTO {
  @IsEnum([...EDITABLE_USER_STATUS], { expose: true, optional: true })
  accessor status: typeof EDITABLE_USER_STATUS[number] | undefined
}

/** `:id` route param shared by every admin by-id endpoint (`GET`/`PATCH /users/:id`). */
export class UserIdParamsRTO extends BaseRTO {
  @IsObjectID({ expose: true })
  accessor id!: string
}

/** `GET /users/search` query — admin listing, paginated/filterable/searchable. */
export class SearchUsersRTO extends SearchPaginationRTO {
  @IsString({ expose: true, optional: true })
  accessor query: string | undefined

  @IsEnum([...USER_STATUS], { expose: true, optional: true })
  accessor status: UserStatus | undefined
}

/** `GET /users/lookup` query — the exact email of the account to find. */
export class LookupUserRTO extends BaseRTO {
  @IsLookupEmail({ expose: true })
  accessor email!: string
}
