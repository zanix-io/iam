import { BaseRTO, IsBoolean, IsDate, IsObjectID, IsString } from '@zanix/validator'
import { SearchPaginationRTO } from '@zanix/datamaster'

/** `POST /grant-access` body. */
export class CreateGrantAccessRTO extends BaseRTO {
  @IsObjectID({ expose: true })
  accessor userId!: string

  /** Fully generic, unvalidated string — see `GrantAccessAttrs.resourceId`'s own doc
   * (`server/repositories/grant-access/model.defs.ts`) for the default `"${appName}:${operationName}"`
   * naming convention. */
  @IsString({ expose: true })
  accessor resourceId!: string

  /** Plain, opaque, unowned tenant id — see `GrantAccessAttrs.tenantId`'s own doc. Omit for a
   * grant scoped globally. */
  @IsString({ expose: true, optional: true })
  accessor tenantId: string | undefined

  @IsString({ expose: true })
  accessor accessLevel!: string

  @IsDate({ optional: true })
  accessor expiresAt: Date | undefined

  @IsBoolean({ expose: true, optional: true })
  accessor isActive: boolean = true
}

/** `PATCH /grant-access/:id` body — every field optional; `userId`/`resourceId`/`tenantId` are
 * immutable once created (mirroring `roles`' own `code`/`tenantId` immutability — see
 * `EditRoleRTO`'s own doc for the identical reasoning applied here to a grant's unique-index
 * tuple). Revoke and re-create the grant instead. */
export class EditGrantAccessRTO extends BaseRTO {
  @IsString({ expose: true, optional: true })
  accessor accessLevel: string | undefined

  @IsDate({ optional: true })
  accessor expiresAt: Date | undefined

  @IsBoolean({ expose: true, optional: true })
  accessor isActive: boolean | undefined
}

/** `:id` route param shared by every `grant-access` by-id endpoint. */
export class GrantAccessIdParamsRTO extends BaseRTO {
  @IsObjectID({ expose: true })
  accessor id!: string
}

/** `GET /grant-access` query — paginated/filterable listing. */
export class SearchGrantAccessRTO extends SearchPaginationRTO {
  @IsObjectID({ expose: true, optional: true })
  accessor userId: string | undefined

  @IsString({ expose: true, optional: true })
  accessor resourceId: string | undefined

  @IsString({ expose: true, optional: true })
  accessor tenantId: string | undefined
}

/** `GET /grant-access/check` query — does `userId` have at-least-`accessLevel` access to
 * `resourceId` (optionally within `tenantId`)? See `GrantAccessService.checkAccess`'s own doc. */
export class CheckGrantAccessRTO extends BaseRTO {
  @IsObjectID({ expose: true })
  accessor userId!: string

  @IsString({ expose: true })
  accessor resourceId!: string

  @IsString({ expose: true, optional: true })
  accessor tenantId: string | undefined

  @IsString({ expose: true })
  accessor accessLevel!: string
}
