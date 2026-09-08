import { Controller, Get, type HandlerContext, Patch, Post, ZanixController } from '@zanix/server'
import { AuthTokenValidation } from '@zanix/auth'
import {
  AdminEditUserRTO,
  SearchUsersRTO,
  UserIdParamsRTO,
  UserProfileRTO,
  UserRegisterRTO,
} from './rtos/user-settings.ts'
import { UsersService } from '../interactors/users.interactor.ts'
import { RBAC_PERMISSIONS } from 'utils/constants.ts'

/** Either `userRead` or `userWrite` may list/view — see `auth-permissions-and-rate-limiting`'s
 * OR-not-AND semantics. */
const anyUserPermission = [RBAC_PERMISSIONS.userRead, RBAC_PERMISSIONS.userWrite]

/**
 * Profile/settings + administrative registration endpoints for the `users` domain slice.
 *
 * Two distinct authorization tiers, not one uniform gate:
 * - **Self-scoped** (`getOwnProfile`/`updateOwnProfile`) act only on the CALLER's own profile,
 *   resolved from the session subject (`UsersService.resolveOwnAuth`) — these require only a
 *   valid session (`@AuthTokenValidation()`, no `permissions`), the same as any other account
 *   managing its own data. Gating these behind an admin permission would break ordinary
 *   self-service and isn't the real risk this controller ever had.
 * - **Admin-scoped** (`register`, `search`, `getById`, `updateById`) act on an ARBITRARY other
 *   account, the whole population, or create a brand-new account entirely — these now require
 *   `RBAC_PERMISSIONS.userRead`/`userWrite` (see that constant's own doc for why registration and
 *   edit-by-id share `userWrite` rather than a narrower split). Previously every route here only
 *   required a valid session with no `permissions` option, before the `roles`/`permissions`
 *   slices existed — that gap is now closed.
 */
@Controller({ prefix: 'users', Interactor: UsersService })
export class UsersController extends ZanixController<UsersService> {
  /**
   * Registers a new user profile and its authentication record. See `UsersService.registerUser`
   * for the invite-on-no-password behavior. Admin-scoped: creates a brand-new account, not the
   * caller's own.
   */
  @Post('register', { Body: UserRegisterRTO })
  @AuthTokenValidation({ permissions: RBAC_PERMISSIONS.userWrite })
  public register(ctx: HandlerContext<{ body: UserRegisterRTO }>) {
    return this.interactor.registerUser(ctx.payload.body)
  }

  /** Returns the caller's own profile. Self-scoped — no `permissions` beyond a valid session. */
  @Get()
  @AuthTokenValidation()
  public getOwnProfile(_ctx: HandlerContext) {
    return this.interactor.getOwnProfile()
  }

  /**
   * Updates the caller's own profile — never `status`, that's admin-only (see `updateById`).
   * Self-scoped — no `permissions` beyond a valid session.
   */
  @Patch({ Body: UserProfileRTO })
  @AuthTokenValidation()
  public updateOwnProfile(ctx: HandlerContext<{ body: UserProfileRTO }>) {
    return this.interactor.updateOwnProfile(ctx.payload.body)
  }

  /** Paginated, filterable/searchable admin listing of profiles. Admin-scoped: returns the whole
   * population, not just the caller's own profile. */
  @Get('search', { Search: SearchUsersRTO })
  @AuthTokenValidation({ permissions: anyUserPermission })
  public search(ctx: HandlerContext<{ search: SearchUsersRTO }>) {
    return this.interactor.searchUsers(ctx.payload.search)
  }

  /** Gets a profile by `:id`. Admin-scoped: `:id` is arbitrary, not necessarily the caller's own. */
  @Get(':id', { Params: UserIdParamsRTO })
  @AuthTokenValidation({ permissions: anyUserPermission })
  public getById(ctx: HandlerContext<{ params: UserIdParamsRTO }>) {
    return this.interactor.getUserById(ctx.payload.params.id)
  }

  /** Updates a profile by `:id`, including its `status` — see `UsersService.updateUserById`.
   * Admin-scoped: `:id` is arbitrary, and this is the only route that can deactivate an account. */
  @Patch(':id', { Params: UserIdParamsRTO, Body: AdminEditUserRTO })
  @AuthTokenValidation({ permissions: RBAC_PERMISSIONS.userWrite })
  public updateById(ctx: HandlerContext<{ body: AdminEditUserRTO; params: UserIdParamsRTO }>) {
    const { id } = ctx.payload.params
    return this.interactor.updateUserById(id, ctx.payload.body)
  }
}
