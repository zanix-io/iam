import { BaseRTO, IsObjectID, IsString } from '@zanix/validator'
import { SearchPaginationRTO } from '@zanix/datamaster'

/** `POST /roles` body. */
export class CreateRoleRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor name!: string

  @IsString({ expose: true })
  accessor code!: string

  @IsString({ expose: true })
  accessor description!: string

  /** Plain, opaque, unowned tenant id — see `RolesAttrs.tenantId`'s own doc. Omit for a
   * global/system role. */
  @IsString({ expose: true, optional: true })
  accessor tenantId: string | undefined

  @IsObjectID({ each: true, expose: true })
  accessor permissions!: string[]
}

/** `PATCH /roles/:id` body — every field optional, `code`/`tenantId` are immutable once created
 * (mirroring `code`'s own immutability — moving a role between tenants, or between tenant-scoped
 * and global, would need to re-validate the `{code, tenantId}` uniqueness tuple against a
 * different key than the one this endpoint's own `id` param already identifies; not supported by
 * this slice). Create a new role under the desired `tenantId` instead. */
export class EditRoleRTO extends BaseRTO {
  @IsString({ expose: true, optional: true })
  accessor name: string | undefined

  @IsString({ expose: true, optional: true })
  accessor description: string | undefined

  @IsObjectID({ each: true, expose: true, optional: true })
  accessor permissions: string[] | undefined
}

/** `:id` route param shared by every `roles` by-id endpoint. */
export class RoleIdParamsRTO extends BaseRTO {
  @IsObjectID({ expose: true })
  accessor id!: string
}

/** `GET /roles` query — paginated/searchable listing. */
export class SearchRolesRTO extends SearchPaginationRTO {
  @IsString({ expose: true, optional: true })
  accessor query: string | undefined

  /** Exact-match filter — see `RolesRepository.searchRoles`'s own doc for why this never merges
   * with the global (`tenantId`-absent) catalog. Omit to list every role regardless of tenant. */
  @IsString({ expose: true, optional: true })
  accessor tenantId: string | undefined
}

/** `POST /roles/assign` body — assigns `roleId` to the `auth` account `authId`. */
export class AssignRoleRTO extends BaseRTO {
  @IsObjectID({ expose: true })
  accessor authId!: string

  @IsObjectID({ expose: true })
  accessor roleId!: string
}
