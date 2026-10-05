import { BaseRTO, IsBoolean, IsObjectID, IsString, Match } from '@zanix/validator'
import { SearchPaginationRTO } from '@zanix/datamaster'
import { IsPermission } from './validations/is-permission.ts'
import { VERSION_PATTERN } from './roles.ts'

/** `POST /permissions` body. */
export class CreatePermissionRTO extends BaseRTO {
  @IsPermission({ expose: true })
  accessor code!: string

  @IsString({ expose: true })
  accessor name!: string

  @IsString({ expose: true })
  accessor description!: string

  @IsString({ expose: true, optional: true, each: true })
  accessor categories: string[] | undefined

  @IsBoolean({ expose: true, optional: true })
  accessor isActive: boolean = true
}

/** `PATCH /permissions/:id` body — every field optional, `code` is immutable once created. */
export class EditPermissionRTO extends BaseRTO {
  @IsString({ expose: true, optional: true })
  accessor name: string | undefined

  @IsString({ expose: true, optional: true })
  accessor description: string | undefined

  @IsString({ expose: true, optional: true, each: true })
  accessor categories: string[] | undefined

  @IsBoolean({ expose: true, optional: true })
  accessor isActive: boolean | undefined

  /** The version of the permission the client read (its `updatedAt`, ISO 8601). Optional: sent,
   * the edit applies only if the permission is still at that version (otherwise `409`,
   * `PERMISSION_VERSION_CONFLICT`); omitted, the last edit wins. */
  @Match(VERSION_PATTERN, { expose: true, optional: true })
  @IsString({ expose: true, optional: true })
  accessor updatedAt: string | undefined
}

/** `:id` route param shared by every `permissions` by-id endpoint. */
export class PermissionIdParamsRTO extends BaseRTO {
  @IsObjectID({ expose: true })
  accessor id!: string
}

/** `GET /permissions` query — paginated/searchable listing. */
export class SearchPermissionsRTO extends SearchPaginationRTO {
  @IsString({ expose: true, optional: true })
  accessor query: string | undefined
}
