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
  AssignRoleRTO,
  CreateRoleRTO,
  EditRoleRTO,
  RoleIdParamsRTO,
  SearchRolesRTO,
} from './rtos/roles.ts'
import { RolesService } from '../interactors/roles.interactor.ts'
import { RBAC_PERMISSIONS } from 'utils/constants.ts'

/** Either `roleRead` or `roleWrite` may list/view — see `auth-permissions-and-rate-limiting`'s
 * OR-not-AND semantics. */
const anyRolePermission = [RBAC_PERMISSIONS.roleRead, RBAC_PERMISSIONS.roleWrite]

/** Admin endpoints for the `roles` domain slice — every route requires `RBAC_PERMISSIONS`. */
@Controller({ prefix: 'roles', Interactor: RolesService })
export class RolesController extends ZanixController<RolesService> {
  /** Creates a new role. */
  @Post('', { Body: CreateRoleRTO })
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

  /** Edits a role by `:id`. */
  @Patch(':id', { Params: RoleIdParamsRTO, Body: EditRoleRTO })
  @AuthTokenValidation({ permissions: RBAC_PERMISSIONS.roleWrite })
  public update(ctx: HandlerContext<{ params: RoleIdParamsRTO; body: EditRoleRTO }>) {
    return this.interactor.editRole(ctx.payload.params.id, ctx.payload.body)
  }

  /** Deletes a role by `:id`. */
  @Delete(':id', { Params: RoleIdParamsRTO })
  @AuthTokenValidation({ permissions: RBAC_PERMISSIONS.roleWrite })
  public remove(ctx: HandlerContext<{ params: RoleIdParamsRTO }>) {
    return this.interactor.deleteRole(ctx.payload.params.id)
  }

  /** Assigns a role to an `auth` account — see `RolesService.assignRole`'s own doc. */
  @Post('assign', { Body: AssignRoleRTO })
  @AuthTokenValidation({ permissions: RBAC_PERMISSIONS.roleWrite })
  public assign(ctx: HandlerContext<{ body: AssignRoleRTO }>) {
    return this.interactor.assignRole(ctx.payload.body)
  }
}
