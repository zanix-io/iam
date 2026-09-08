import { Controller, Get, type HandlerContext, Patch, Post, ZanixController } from '@zanix/server'
import { AuthTokenValidation } from '@zanix/auth'
import {
  CreatePermissionRTO,
  EditPermissionRTO,
  PermissionIdParamsRTO,
  SearchPermissionsRTO,
} from './rtos/permissions.ts'
import { PermissionsService } from '../interactors/permissions.interactor.ts'
import { RBAC_PERMISSIONS } from 'utils/constants.ts'

/** Either `permissionRead` or `permissionWrite` may list/view — see
 * `auth-permissions-and-rate-limiting`'s OR-not-AND semantics. */
const anyPermissionPermission = [RBAC_PERMISSIONS.permissionRead, RBAC_PERMISSIONS.permissionWrite]

/** Admin endpoints for the `permissions` domain slice's own catalog. */
@Controller({ prefix: 'permissions', Interactor: PermissionsService })
export class PermissionsController extends ZanixController<PermissionsService> {
  /** Creates a new permission. */
  @Post('', { Body: CreatePermissionRTO })
  @AuthTokenValidation({ permissions: RBAC_PERMISSIONS.permissionWrite })
  public create(ctx: HandlerContext<{ body: CreatePermissionRTO }>) {
    return this.interactor.createPermission(ctx.payload.body)
  }

  /** Paginated, filterable/searchable listing of the permission catalog. */
  @Get('', { Search: SearchPermissionsRTO })
  @AuthTokenValidation({ permissions: anyPermissionPermission })
  public search(ctx: HandlerContext<{ search: SearchPermissionsRTO }>) {
    return this.interactor.getPermissions(ctx.payload.search)
  }

  /** Gets a permission by `:id`. */
  @Get(':id', { Params: PermissionIdParamsRTO })
  @AuthTokenValidation({ permissions: anyPermissionPermission })
  public getById(ctx: HandlerContext<{ params: PermissionIdParamsRTO }>) {
    return this.interactor.getPermissionById(ctx.payload.params.id)
  }

  /** Edits a permission by `:id`. */
  @Patch(':id', { Params: PermissionIdParamsRTO, Body: EditPermissionRTO })
  @AuthTokenValidation({ permissions: RBAC_PERMISSIONS.permissionWrite })
  public update(
    ctx: HandlerContext<{ params: PermissionIdParamsRTO; body: EditPermissionRTO }>,
  ) {
    return this.interactor.editPermission(ctx.payload.params.id, ctx.payload.body)
  }
}
