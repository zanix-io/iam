import {
  ArrayLength,
  BaseRTO,
  IsBoolean,
  IsObjectID,
  IsString,
  Length,
  Match,
} from '@zanix/validator'
import { MAX_PERMISSIONS_PER_ROLE, MAX_ROLE_IDS_PER_REQUEST } from 'utils/constants.ts'
import { MaxItems } from './validations/max-items.ts'
import { SearchPaginationRTO } from '@zanix/datamaster'

/** Text with no control characters, bidirectional marks or zero-width characters (Unicode
 * categories Cc, Cf, Zl, Zp), and no leading or trailing space. */
const SAFE_TEXT =
  /^[^\s\p{Cc}\p{Cf}\p{Zl}\p{Zp}](?:[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*[^\s\p{Cc}\p{Cf}\p{Zl}\p{Zp}])?$/u

/** A role `code`: lowercase letters and digits in groups joined by `-`, `_`, `.` or `:`. */
const ROLE_CODE = /^[a-z0-9]+(?:[-_.:][a-z0-9]+)*$/

/** The version of a role or permission as clients read it: its `updatedAt`, ISO 8601. */
export const VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/

/** `POST /roles` body. */
export class CreateRoleRTO extends BaseRTO {
  @Match(SAFE_TEXT, { expose: true })
  @Length({ min: 2, max: 80 }, { expose: true })
  @IsString({ expose: true })
  accessor name!: string

  @Match(ROLE_CODE, { expose: true })
  @Length({ min: 2, max: 64 }, { expose: true })
  @IsString({ expose: true })
  accessor code!: string

  @Match(SAFE_TEXT, { expose: true })
  @Length({ min: 1, max: 500 }, { expose: true })
  @IsString({ expose: true })
  accessor description!: string

  /** Plain, opaque, unowned tenant id — see `RolesAttrs.tenantId`'s own doc. Omit for a
   * global/system role. */
  @IsString({ expose: true, optional: true })
  accessor tenantId: string | undefined

  @MaxItems(MAX_PERMISSIONS_PER_ROLE, { expose: true })
  @IsObjectID({ each: true, expose: true })
  accessor permissions!: string[]

  /** Marks the role as a system role (never editable or deletable). Only a caller holding `*`
   * may set it. */
  @IsBoolean({ expose: true, optional: true })
  accessor isSystem: boolean | undefined
}

/** `PATCH /roles/:id` body — every field optional, `code`/`tenantId`/`isSystem` are immutable once
 * created (mirroring `code`'s own immutability — moving a role between tenants, or between
 * tenant-scoped and global, would need to re-validate the `{code, tenantId}` uniqueness tuple
 * against a different key than the one this endpoint's own `id` param already identifies; not
 * supported). Create a new role under the desired `tenantId` instead.
 *
 * `updatedAt` is the version of the role the client read. Optional: sent, the edit applies only if
 * the role is still at that version (otherwise `409`, `ROLE_VERSION_CONFLICT`); omitted, the edit
 * applies to whatever is there, and the last edit wins. Clients that edit from a form (`console`)
 * should always send it. */
export class EditRoleRTO extends BaseRTO {
  @Match(SAFE_TEXT, { expose: true, optional: true })
  @Length({ min: 2, max: 80 }, { expose: true, optional: true })
  @IsString({ expose: true, optional: true })
  accessor name: string | undefined

  @Match(SAFE_TEXT, { expose: true, optional: true })
  @Length({ min: 1, max: 500 }, { expose: true, optional: true })
  @IsString({ expose: true, optional: true })
  accessor description: string | undefined

  @MaxItems(MAX_PERMISSIONS_PER_ROLE, { expose: true, optional: true })
  @IsObjectID({ each: true, expose: true, optional: true })
  accessor permissions: string[] | undefined

  @Match(VERSION_PATTERN, { expose: true, optional: true })
  @IsString({ expose: true, optional: true })
  accessor updatedAt: string | undefined
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

/**
 * `POST /roles/assign` body — makes `roleId` the ONLY role of the `auth` account `authId`
 * (it replaces every role the account holds). To keep the roles an account already has, use
 * `POST /roles/add`.
 */
export class AssignRoleRTO extends BaseRTO {
  @IsObjectID({ expose: true })
  accessor authId!: string

  @IsObjectID({ expose: true })
  accessor roleId!: string
}

/** `POST /roles/add` and `POST /roles/remove` body — `roleIds` (at least one) of the `auth`
 * account `authId`. */
export class AccountRolesRTO extends BaseRTO {
  @IsObjectID({ expose: true })
  accessor authId!: string

  @ArrayLength({ min: 1, max: MAX_ROLE_IDS_PER_REQUEST }, { expose: true })
  @IsObjectID({ each: true, expose: true })
  accessor roleIds!: string[]
}

/** `:authId` route param of the `roles/accounts` endpoints. */
export class AuthIdParamsRTO extends BaseRTO {
  @IsObjectID({ expose: true })
  accessor authId!: string
}

/** `PUT /roles/accounts/:authId` body — the exact set of roles the account holds; empty removes
 * them all. */
export class SetRolesRTO extends BaseRTO {
  @MaxItems(MAX_ROLE_IDS_PER_REQUEST, { expose: true })
  @IsObjectID({ each: true, expose: true })
  accessor roleIds!: string[]
}
