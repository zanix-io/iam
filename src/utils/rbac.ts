import type { PermissionsAttrs } from 'server/repositories/permissions/model.defs.ts'
import type { RolesAttrs } from 'server/repositories/roles/model.defs.ts'

/**
 * A `roles` document with its `permissions` ref array actually populated (see
 * `RolesRepository.findById`'s own `populate` option) — the shape `resolveEffectivePermissions`
 * below (and any host override registered under `auth.app.ts`'s `resolveEffectivePermissions`
 * behavior) actually receives. `undefined`/`null` covers an account with no role assigned, or a
 * `roleId` that no longer resolves to a real document.
 */
export type PopulatedRole =
  | (Omit<RolesAttrs, 'permissions'> & { permissions?: PermissionsAttrs[] })
  | undefined
  | null

/**
 * Default RBAC evaluation strategy: flattens a role's own populated `permissions` into the plain
 * list of permission CODES embedded into a session token's `aud` claim at login (see
 * `AuthService`/`PasswordService`'s own token-issuing methods) — every `isActive: false`
 * permission is dropped, so deactivating one from the catalog (`PermissionsService.editPermission`)
 * takes effect for every role referencing it, without editing each role individually.
 *
 * Registered as `auth.app.ts`'s own `resolveEffectivePermissions` behavior default — a host may
 * override this entirely (a role hierarchy, a wildcard-expansion policy, an external policy
 * engine, ...) without forking `AuthService`. See that manifest entry's own doc for the override
 * mechanism, and `@zanix/app`'s behaviors documentation for the general pattern.
 *
 * ⚠️ Only ever re-evaluated at LOGIN, never on refresh — see `AuthService.resolveSessionPermissions`'s
 * own doc for why, and the mitigation `RolesService.assignRole` applies.
 */
export function resolveEffectivePermissions(role: PopulatedRole): string[] {
  if (!role?.permissions?.length) return []
  return role.permissions
    .filter((permission): permission is PermissionsAttrs => Boolean(permission?.isActive))
    .map((permission) => permission.code)
}
