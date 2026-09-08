import {
  Controller,
  Delete,
  Get,
  type HandlerContext,
  Patch,
  Post,
  ZanixController,
} from '@zanix/server'
import { AuthTokenValidation } from '@zanix/auth'
import {
  CheckGrantAccessRTO,
  CreateGrantAccessRTO,
  EditGrantAccessRTO,
  GrantAccessIdParamsRTO,
  SearchGrantAccessRTO,
} from './rtos/grant-access.ts'
import { GrantAccessService } from '../interactors/grant-access.interactor.ts'
import { RBAC_PERMISSIONS } from 'utils/constants.ts'

/** Either `grantAccessRead` or `grantAccessWrite` may list/view/check — see
 * `auth-permissions-and-rate-limiting`'s OR-not-AND semantics. */
const anyGrantAccessPermission = [
  RBAC_PERMISSIONS.grantAccessRead,
  RBAC_PERMISSIONS.grantAccessWrite,
]

/**
 * Admin endpoints for the `grant-access` domain slice — every route requires `RBAC_PERMISSIONS`,
 * exactly like `RolesController`/`PermissionsController` (see `GrantAccessService`'s own doc for
 * why this deliberately does NOT reuse the grounding reference's own hand-rolled authorization).
 */
@Controller({ prefix: 'grant-access', Interactor: GrantAccessService })
export class GrantAccessController extends ZanixController<GrantAccessService> {
  /** Creates a new grant. */
  @Post('', { Body: CreateGrantAccessRTO })
  @AuthTokenValidation({ permissions: RBAC_PERMISSIONS.grantAccessWrite })
  public create(ctx: HandlerContext<{ body: CreateGrantAccessRTO }>) {
    return this.interactor.createGrant(ctx.payload.body)
  }

  /** Paginated, filterable listing of grants. */
  @Get('', { Search: SearchGrantAccessRTO })
  @AuthTokenValidation({ permissions: anyGrantAccessPermission })
  public search(ctx: HandlerContext<{ search: SearchGrantAccessRTO }>) {
    return this.interactor.getGrants(ctx.payload.search)
  }

  /** Does a user have at-least-level access to a resource? See
   * `GrantAccessService.checkAccess`'s own doc. */
  @Get('check', { Search: CheckGrantAccessRTO })
  @AuthTokenValidation({ permissions: anyGrantAccessPermission })
  public check(ctx: HandlerContext<{ search: CheckGrantAccessRTO }>) {
    return this.interactor.checkAccess(ctx.payload.search)
  }

  /** Gets a grant by `:id`. */
  @Get(':id', { Params: GrantAccessIdParamsRTO })
  @AuthTokenValidation({ permissions: anyGrantAccessPermission })
  public getById(ctx: HandlerContext<{ params: GrantAccessIdParamsRTO }>) {
    return this.interactor.getGrantById(ctx.payload.params.id)
  }

  /** Edits a grant by `:id`. */
  @Patch(':id', { Params: GrantAccessIdParamsRTO, Body: EditGrantAccessRTO })
  @AuthTokenValidation({ permissions: RBAC_PERMISSIONS.grantAccessWrite })
  public update(
    ctx: HandlerContext<{ params: GrantAccessIdParamsRTO; body: EditGrantAccessRTO }>,
  ) {
    return this.interactor.editGrant(ctx.payload.params.id, ctx.payload.body)
  }

  /** Revokes a grant by `:id`. */
  @Delete(':id', { Params: GrantAccessIdParamsRTO })
  @AuthTokenValidation({ permissions: RBAC_PERMISSIONS.grantAccessWrite })
  public remove(ctx: HandlerContext<{ params: GrantAccessIdParamsRTO }>) {
    return this.interactor.revokeGrant(ctx.payload.params.id)
  }
}
