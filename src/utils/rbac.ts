import type { PermissionsAttrs } from 'server/repositories/permissions/model.defs.ts'
import type { RolesAttrs } from 'server/repositories/roles/model.defs.ts'

import { resolveBehavior } from '@zanix/app/runtime'

/**
 * A `roles` document with its `permissions` ref array actually populated (see
 * `RolesRepository.findById`'s own `populate` option) — the shape `resolveEffectivePermissions`
 * below (and any host override registered under `auth.app.ts`'s `resolveEffectivePermissions`
 * behavior) actually receives. `undefined`/`null` covers an account with no role assigned, or a
 * role id that no longer resolves to a real document.
 */
export type PopulatedRole =
  | (Omit<RolesAttrs, 'permissions'> & { permissions?: PermissionsAttrs[] })
  | undefined
  | null

/** The provider lookup of a `ZanixInteractor` (`this.providers`). */
export type Providers = { get: <T>(provider: new () => T) => T }

/** A role that exists, with its `permissions` populated — what `RolesRepository` hands back for
 * the reads that populate them. */
export type PopulatedRoleDoc = NonNullable<PopulatedRole>

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
 * It evaluates ONE role. An account with several roles gets the union of this function's result
 * for each of them (`unionPermissions`), so an override keeps this one-role signature.
 *
 * Re-evaluated at login and on every refresh — see `AuthService.resolveSessionPermissions`'s own
 * doc, and `RolesService.assignRole` for why a role change needs no forced re-login.
 */
export function resolveEffectivePermissions(role: PopulatedRole): string[] {
  if (!role?.permissions?.length) return []
  return role.permissions
    .filter((permission): permission is PermissionsAttrs => Boolean(permission?.isActive))
    .map((permission) => permission.code)
}

/** The role ids an `auth` account holds, as plain strings without repeats, in assignment order;
 * empty when it holds none. */
export function effectiveRoleIds(auth?: { roleIds?: readonly unknown[] | null } | null): string[] {
  return [...new Set((auth?.roleIds ?? []).map(String))]
}

/**
 * The role ids exactly as an `auth` document stores them, repeats and order included. Conditional
 * writes (`replaceRoleIds`, `pullRoleIds`) compare against this, not against
 * {@linkcode effectiveRoleIds}: a document that holds a repeated id would never match a
 * de-duplicated copy of itself.
 */
export function storedRoleIds(auth?: { roleIds?: readonly unknown[] | null } | null): string[] {
  return (auth?.roleIds ?? []).map(String)
}

/** Merges permission-code lists into one list without repeats, keeping first-seen order. */
export function unionPermissions(lists: readonly (readonly string[])[]): string[] {
  return [...new Set(lists.flat())]
}

/**
 * The permission codes of ONE role through the strategy the host registered under the `auth` app's
 * `resolveEffectivePermissions` behavior, else {@linkcode resolveEffectivePermissions}.
 */
export function resolveRolePermissions(role: PopulatedRole): string[] {
  const strategy = resolveBehavior<(role: PopulatedRole) => string[]>(
    'auth',
    'resolveEffectivePermissions',
  ) ?? resolveEffectivePermissions
  return strategy(role)
}

/** The permission codes of all `roles` merged without repeats — what a session carries. */
export function permissionsOfRoles(roles: readonly PopulatedRole[]): string[] {
  return unionPermissions(roles.map((role) => resolveRolePermissions(role)))
}
