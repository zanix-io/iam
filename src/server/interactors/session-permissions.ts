import { RolesRepository } from '../repositories/roles/entity.provider.ts'
import { effectiveRoleIds, permissionsOfRoles, type Providers } from 'utils/rbac.ts'

/**
 * The permission codes a session carries for an account holding `roleIds` (`[]` when it holds
 * none — an authenticated-but-unprivileged session, matching `AuthTokenValidation` with no
 * `permissions` option): the roles are read with one query and merged by `permissionsOfRoles`. A
 * host's `resolveEffectivePermissions` behavior evaluates each role (a hierarchy, an external
 * policy engine, ...) without forking the callers.
 *
 * Every sign-in path of `AuthService` and `PasswordService` and `AuthService.refreshTokens` call
 * it. `@zanix/auth`'s `session.refreshTokens(token, sessionOptions)` merges a `sessionOptions`
 * override over the refresh token's own, which is what makes re-resolving permissions on refresh
 * (not just at login) take effect: a role or permission change reaches the next refresh, with no
 * forced revoke (see `RolesService.assignRole`).
 */
export async function permissionsForRoleIds(
  providers: Providers,
  roleIds: string[],
): Promise<string[]> {
  if (!roleIds.length) return []
  return permissionsOfRoles(await providers.get(RolesRepository).findManyWithPermissions(roleIds))
}

/** {@linkcode permissionsForRoleIds} for an `auth` account (`undefined` has no roles). */
export function permissionsForAccount(
  providers: Providers,
  auth?: { roleIds?: readonly unknown[] | null } | null,
): Promise<string[]> {
  return permissionsForRoleIds(providers, effectiveRoleIds(auth))
}
