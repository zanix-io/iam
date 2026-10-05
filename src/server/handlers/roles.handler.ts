import {
  Controller,
  Delete,
  Get,
  type HandlerContext,
  Patch,
  Post,
  Put,
  ZanixController,
} from '@zanix/server'
import { AuthTokenValidation } from '@zanix/auth'
import {
  AccountRolesRTO,
  AssignRoleRTO,
  AuthIdParamsRTO,
  CreateRoleRTO,
  EditRoleRTO,
  RoleIdParamsRTO,
  SearchRolesRTO,
  SetRolesRTO,
} from './rtos/roles.ts'
import { RolesService } from '../interactors/roles.interactor.ts'
import { RBAC_PERMISSIONS } from 'utils/constants.ts'
import { AdminMutationRateLimit } from 'utils/admin-rate-limit.ts'
import { SearchPaginationRTO } from '@zanix/datamaster'

/** Either `roleRead` or `roleWrite` may list/view —
 * `AuthTokenValidation`'s `permissions` list is OR, not AND. */
const anyRolePermission = [RBAC_PERMISSIONS.roleRead, RBAC_PERMISSIONS.roleWrite]

/** Admin endpoints for the `roles` domain — every route requires `RBAC_PERMISSIONS`. */
@Controller({ prefix: 'roles', Interactor: RolesService })
export class RolesController extends ZanixController<RolesService> {
  /** Creates a new role. */
  @Post('', { Body: CreateRoleRTO })
  @AdminMutationRateLimit()
  @AuthTokenValidation({ permissions: RBAC_PERMISSIONS.roleWrite })
  public create(ctx: HandlerContext<{ body: CreateRoleRTO }>) {
    return this.interactor.createRole(ctx.payload.body)
  }

  /** Paginated, filterable/searchable listing of roles. */
  @Get('', { Search: SearchRolesRTO })
  @AuthTokenValidation({ permissions: anyRolePermission })
  public search(ctx: HandlerContext<{ search: SearchRolesRTO }>) {
    return this.interactor.getRoles(ctx.payload.search)
  }

  /** Gets a role by `:id`, with its `permissions` populated. */
  @Get(':id', { Params: RoleIdParamsRTO })
  @AuthTokenValidation({ permissions: anyRolePermission })
  public getById(ctx: HandlerContext<{ params: RoleIdParamsRTO }>) {
    return this.interactor.getRoleById(ctx.payload.params.id)
  }

  /**
   * One page of the people holding the role `:id` (`authId`, `userId`, name, status; no contact
   * data), with the total.
   */
  @Get(':id/holders', { Params: RoleIdParamsRTO, Search: SearchPaginationRTO })
  @AuthTokenValidation({ permissions: anyRolePermission })
  public holders(
    ctx: HandlerContext<{ params: RoleIdParamsRTO; search: SearchPaginationRTO }>,
  ) {
    const { page, limit } = ctx.payload.search
    return this.interactor.getRoleHolders(ctx.payload.params.id, { page, limit })
  }

  /** Edits a role by `:id`. */
  @Patch(':id', { Params: RoleIdParamsRTO, Body: EditRoleRTO })
  @AdminMutationRateLimit()
  @AuthTokenValidation({ permissions: RBAC_PERMISSIONS.roleWrite })
  public update(ctx: HandlerContext<{ params: RoleIdParamsRTO; body: EditRoleRTO }>) {
    return this.interactor.editRole(ctx.payload.params.id, ctx.payload.body)
  }

  /** Deletes a role by `:id`. */
  @Delete(':id', { Params: RoleIdParamsRTO })
  @AdminMutationRateLimit()
  @AuthTokenValidation({ permissions: RBAC_PERMISSIONS.roleWrite })
  public remove(ctx: HandlerContext<{ params: RoleIdParamsRTO }>) {
    return this.interactor.deleteRole(ctx.payload.params.id)
  }

  /** Makes a role the only role of an `auth` account — see `RolesService.assignRole`'s own doc. */
  @Post('assign', { Body: AssignRoleRTO })
  @AdminMutationRateLimit()
  @AuthTokenValidation({ permissions: RBAC_PERMISSIONS.roleWrite })
  public assign(ctx: HandlerContext<{ body: AssignRoleRTO }>) {
    return this.interactor.assignRole(ctx.payload.body)
  }

  /** Adds roles to an `auth` account, keeping the ones it holds — see `RolesService.addRoles`. */
  @Post('add', { Body: AccountRolesRTO })
  @AdminMutationRateLimit()
  @AuthTokenValidation({ permissions: RBAC_PERMISSIONS.roleWrite })
  public add(ctx: HandlerContext<{ body: AccountRolesRTO }>) {
    return this.interactor.addRoles(ctx.payload.body)
  }

  /** Removes roles from an `auth` account — see `RolesService.removeRoles`. */
  @Post('remove', { Body: AccountRolesRTO })
  @AdminMutationRateLimit()
  @AuthTokenValidation({ permissions: RBAC_PERMISSIONS.roleWrite })
  public removeFromAccount(ctx: HandlerContext<{ body: AccountRolesRTO }>) {
    return this.interactor.removeRoles(ctx.payload.body)
  }

  /** The roles an `auth` account holds. */
  @Get('accounts/:authId', { Params: AuthIdParamsRTO })
  @AuthTokenValidation({ permissions: anyRolePermission })
  public getAccountRoles(ctx: HandlerContext<{ params: AuthIdParamsRTO }>) {
    return this.interactor.getAccountRoles(ctx.payload.params.authId)
  }

  /**
   * The permission codes the account `:authId` can actually exercise, each with the roles it comes
   * from — see `RolesService.getAccountPermissions`.
   */
  @Get('accounts/:authId/permissions', { Params: AuthIdParamsRTO })
  @AuthTokenValidation({ permissions: anyRolePermission })
  public getAccountPermissions(ctx: HandlerContext<{ params: AuthIdParamsRTO }>) {
    return this.interactor.getAccountPermissions(ctx.payload.params.authId)
  }

  /** Sets the exact roles of an `auth` account — see `RolesService.setRoles`. */
  @Put('accounts/:authId', { Params: AuthIdParamsRTO, Body: SetRolesRTO })
  @AdminMutationRateLimit()
  @AuthTokenValidation({ permissions: RBAC_PERMISSIONS.roleWrite })
  public setAccountRoles(ctx: HandlerContext<{ params: AuthIdParamsRTO; body: SetRolesRTO }>) {
    return this.interactor.setRoles(ctx.payload.params.authId, ctx.payload.body.roleIds)
  }
}
