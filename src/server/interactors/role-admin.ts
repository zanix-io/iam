import type { PermissionsAttrs } from '../repositories/permissions/model.defs.ts'

import { HttpError } from '@zanix/errors'
import { missingScopes } from '@zanix/auth'
import { AuthRepository } from '../repositories/auth/entity.provider.ts'
import { RolesRepository } from '../repositories/roles/entity.provider.ts'
import { UsersRepository } from '../repositories/users/entity.provider.ts'
import { blocksSignIn, IAM_ERROR_CODES, RBAC_PERMISSIONS } from 'utils/constants.ts'
import {
  effectiveRoleIds,
  permissionsOfRoles,
  type PopulatedRoleDoc,
  type Providers,
  resolveRolePermissions,
} from 'utils/rbac.ts'

export type { Providers }

/**
 * The rules every role-administration path shares, kept in this one module:
 *
 * - **Grant only what you hold** ({@linkcode assertCanGrant}, with the actor's CURRENT permissions
 *   from {@linkcode actorPermissions}). `role-write` is not superadmin: whoever changes what an
 *   account, a role or a permission grants may only touch permissions the caller holds, `*`
 *   meaning all of them. Adding AND taking away both count, so a `role-write` holder cannot
 *   degrade a more privileged account either.
 * - **An administrator remains** ({@linkcode changeProtectingAdministrator}). No change may take
 *   the system from having an account that can manage roles and sign in to having none.
 *
 * Both decide by PERMISSION with `@zanix/auth`'s `scopeValidation`, through the same
 * `resolveEffectivePermissions` strategy sessions use, never by a fixed role id.
 */

/** Something that, once applied, changes who can manage roles. */
export type AdministrationChange =
  /** The account `authId` (profile `userId`, if linked) will hold exactly `roleIds`. */
  | { kind: 'account-roles'; authId: string; userId?: string; roleIds: string[] }
  /** The role `roleId` will carry exactly `permissions`. */
  | { kind: 'role-permissions'; roleId: string; permissions: PermissionsAttrs[] }
  | { kind: 'role-deleted'; roleId: string }
  /** The profile `userId` will stop being able to sign in. */
  | { kind: 'user-blocked'; userId: string }
  | { kind: 'permission-deactivated'; permissionId: string }

/**
 * How a caller applies an {@linkcode AdministrationChange} through
 * {@linkcode changeProtectingAdministrator}.
 */
export type AdministrationMutation = {
  /** Writes the change. `false` means the target changed since it was read and nothing was written. */
  write: () => Promise<boolean>
  /** Puts the previous state back, but only if the target still holds what `write` wrote.
   * `false` means it could not (the target changed again). */
  undo: () => Promise<boolean>
}

type Identified = { id?: unknown; _id?: unknown }

const idOf = (doc: Identified): string => String(doc.id ?? doc._id)

/** A plain, spreadable copy of a document (a Mongoose one through `toObject`), with its `id`. */
export function plain<T extends Identified>(doc: T): T {
  const toObject = (doc as { toObject?: () => T }).toObject
  return typeof toObject === 'function' ? { ...toObject.call(doc), id: idOf(doc) } : { ...doc }
}

/**
 * A document as the API serializes it (a Mongoose one through `toJSON`, which applies the data
 * policies of protected fields), as a plain object that can take extra fields, with its `id`.
 */
export function serialized<T extends Identified>(doc: T): T {
  const toJSON = (doc as { toJSON?: () => T }).toJSON
  return typeof toJSON === 'function' ? { ...toJSON.call(doc), id: idOf(doc) } : { ...doc }
}

/**
 * Who is calling a role-administration operation: an account, with the role ids it holds NOW. An
 * administration operation is always done by an account; a service credential is not one.
 */
export type Actor = { roleIds: string[] }

/**
 * Resolves the caller of an administration operation from the database. The operation has already
 * passed `@AuthTokenValidation({ permissions })`, so only a holder of the route's administrative
 * permission gets here; this step reads the database instead of trusting the token for what the
 * rules need: an administrator who was demoted stops acting at once instead of when the token
 * expires. The ordinary per-request path stays JWT-only and never calls this.
 *
 * The session must be a `user` session whose account still exists and can sign in. A service
 * credential is refused whatever scope it carries, as an `api` session or as a `user` session
 * whose subject is not an account id: administering roles needs an account that can be audited,
 * held to the rules and demoted.
 *
 * @throws {HttpError} `FORBIDDEN` (`ACTOR_NOT_ACCOUNT`) for a session that is not a user session;
 *   `FORBIDDEN` (`ACTOR_NOT_ACTIVE`) when the account is gone or its profile blocks sign-in.
 */
export async function resolveActor(
  providers: Providers,
  session?: { subject?: unknown; type?: string } | null,
): Promise<Actor> {
  const notAccount = () =>
    new HttpError('FORBIDDEN', {
      message: 'Administering roles requires an account, not a service credential.',
      code: IAM_ERROR_CODES.actorNotAccount,
    })
  if (session?.type !== 'user' || !session.subject) throw notAccount()
  // A service credential's token can reach a `user` route on the `Authorization` header (the guard
  // sets the session type from the header, not from the token), with a subject that is a service
  // name and not an account id: it cannot be looked up as an account, and is not one.
  let account
  try {
    account = await providers.get(AuthRepository).findById(String(session.subject))
  } catch (error) {
    if ((error as { name?: string })?.name === 'CastError') throw notAccount()
    throw error
  }
  const profile = account?.userId
    ? await providers.get(UsersRepository).findById(String(account.userId))
    : undefined
  if (!account || blocksSignIn(profile?.status)) {
    throw new HttpError('FORBIDDEN', {
      message: 'Your account no longer exists or is not active.',
      code: IAM_ERROR_CODES.actorNotActive,
    })
  }
  return { roleIds: effectiveRoleIds(account) }
}

/**
 * The permissions `actor` holds, from `roles` (any list containing the roles the actor holds, so
 * an operation that already loaded roles passes them instead of asking again).
 */
export function actorHeld(actor: Actor, roles: readonly PopulatedRoleDoc[]): string[] {
  return permissionsOfRoles(roles.filter((role) => actor.roleIds.includes(idOf(role))))
}

/**
 * Throws unless `held` covers `required`, the administrative permission of the route being served
 * (`role-write` for roles, `permission-write` for permissions, `user-write` for accounts). The
 * guard checked it on the token; this checks it on what the caller holds now, so a demoted
 * administrator cannot do even what asks for no grant (rename a role, create one with no
 * permissions).
 *
 * @throws {HttpError} `FORBIDDEN`, code `ACTOR_LACKS_PERMISSION`, the permission in `meta.required`.
 */
export function assertActorHolds(held: readonly string[], required: string) {
  if (missingScopes([required], held).length) {
    throw new HttpError('FORBIDDEN', {
      message: `You no longer hold the permission this operation needs: ${required}.`,
      code: IAM_ERROR_CODES.actorLacksPermission,
      meta: { required },
      exposeMeta: true,
    })
  }
}

/**
 * Resolves the caller ({@linkcode resolveActor}) and checks that it still holds `required`
 * ({@linkcode assertActorHolds}); answers the permissions it holds now, for the grant rule. `roles`
 * is the role catalog the operation already read, when it did, so that no query is added; omitted,
 * the caller's own roles are read with one query.
 */
export async function authorizeActor(
  providers: Providers,
  session: Parameters<typeof resolveActor>[1],
  required: string,
  roles?: readonly PopulatedRoleDoc[],
): Promise<string[]> {
  const actor = await resolveActor(providers, session)
  const held = actorHeld(
    actor,
    roles ??
      (actor.roleIds.length
        ? await providers.get(RolesRepository).findManyWithPermissions(actor.roleIds)
        : []),
  )
  assertActorHolds(held, required)
  return held
}

/**
 * Throws `FORBIDDEN` unless `held` covers every code in `codes` (see `missingScopes`).
 *
 * @throws {HttpError} `FORBIDDEN`, code `ROLE_GRANT_EXCEEDS_SCOPE`, with the codes not held in
 *   `meta.missing`.
 */
export function assertCanGrant(held: readonly string[] | undefined, codes: readonly string[]) {
  const missing = missingScopes(codes, held)
  if (missing.length) {
    throw new HttpError('FORBIDDEN', {
      message: `You cannot grant or take away permissions you do not hold: ${missing.join(', ')}.`,
      code: IAM_ERROR_CODES.roleGrantExceedsScope,
      meta: { missing },
      exposeMeta: true,
    })
  }
}

/**
 * The codes of the catalog entries a role is made of, active or not. Role CONTENTS are checked
 * this way, while assigning a role is checked against the permissions it grants today
 * (`resolveRolePermissions`): an inactive entry in a role grants nothing yet, but turning it on is
 * gated by the same rule (`PermissionsService.editPermission`), so counting it here is the
 * conservative reading and keeps a role from being built out of permissions its author lacks.
 */
export const catalogCodes = (permissions: readonly { code: string }[]): string[] =>
  permissions.map((permission) => permission.code)

/**
 * The permissions the account of the profile `userId` can exercise: the union over its roles
 * through the host's strategy, from `catalog` (the roles with their permissions, already loaded).
 * What `PATCH /users/:id` compares against before blocking a person (`user-write` cannot block
 * someone it does not cover). `[]` for a profile with no account or no roles.
 */
export async function permissionsOfUser(
  providers: Providers,
  userId: string,
  catalog: readonly PopulatedRoleDoc[],
): Promise<string[]> {
  const account = await providers.get(AuthRepository).findByUserId(userId)
  const held = effectiveRoleIds(account)
  return permissionsOfRoles(catalog.filter((role) => held.includes(idOf(role))))
}

/** Whether `role` grants `role-write` (or `*`). Tenant-scoped roles count like any other: the
 * permission is global to this service whatever `tenantId` the role carries. */
const canManageRoles = (role: PopulatedRoleDoc) =>
  !missingScopes([RBAC_PERMISSIONS.roleWrite], resolveRolePermissions(role)).length

/** `roles` as they will be once `change` is applied. */
function applyChange(
  roles: PopulatedRoleDoc[],
  change?: AdministrationChange,
): PopulatedRoleDoc[] {
  switch (change?.kind) {
    case 'role-deleted':
      return roles.filter((role) => idOf(role) !== change.roleId)
    case 'role-permissions':
      return roles.map((role) =>
        idOf(role) === change.roleId ? { ...plain(role), permissions: change.permissions } : role
      )
    case 'permission-deactivated':
      return roles.map((role) => ({
        ...plain(role),
        permissions: role.permissions?.map((permission) =>
          idOf(permission) === change.permissionId
            ? { ...plain(permission), isActive: false }
            : permission
        ),
      }))
    default:
      return roles
  }
}

/**
 * How many accounts can manage roles AND sign in, with `change` applied when given. An account
 * signs in by the rule every login path applies (`UsersRepository.assertActive`, via
 * `blocksSignIn`): an account with no linked profile, or whose `userId` matches no profile, counts
 * as able to (the "ghost holder" `docs/authorization.md` describes). `roles` is the catalog as
 * read, to reuse a read the caller already made; omitted, it is read here.
 */
export async function countActiveAdministrators(
  providers: Providers,
  change?: AdministrationChange,
  roles?: PopulatedRoleDoc[],
): Promise<number> {
  const catalog = roles ?? await providers.get(RolesRepository).findAllWithPermissions()
  const adminRoleIds = applyChange(catalog, change).filter(canManageRoles).map(idOf)
  if (!adminRoleIds.length) return 0

  const account = change?.kind === 'account-roles' ? change : undefined
  const holders = await providers.get(AuthRepository).findHoldersOfRoleIds(
    adminRoleIds,
    account?.authId,
  )
  if (account?.roleIds.some((id) => adminRoleIds.includes(id))) {
    holders.push({ id: account.authId, userId: account.userId })
  }

  const blocked = await providers.get(UsersRepository).findSignInBlockedIds(
    holders.flatMap((holder) => holder.userId ? [holder.userId] : []),
  )
  if (change?.kind === 'user-blocked') blocked.add(change.userId)
  return holders.filter((holder) => !(holder.userId && blocked.has(holder.userId))).length
}

const lastAdministrator = () =>
  new HttpError('CONFLICT', {
    message: 'The last account able to manage roles cannot lose that ability.',
    code: IAM_ERROR_CODES.lastAdministrator,
  })

/**
 * Refuses `change` when it would leave no account able to manage roles and sign in. A system that
 * already has none (a fresh install) has nothing to protect, so the change goes through.
 *
 * @returns Whether an administrator existed to protect (`false` on a system that had none), which
 *   tells a caller that re-counts after writing whether a count of zero is a violation.
 * @throws {HttpError} `CONFLICT`, code `LAST_ADMINISTRATOR`, when `change` would remove the last
 *   such account.
 */
export async function assertAdministratorRemains(
  providers: Providers,
  change: AdministrationChange,
  roles?: PopulatedRoleDoc[],
): Promise<boolean> {
  const catalog = roles ?? await providers.get(RolesRepository).findAllWithPermissions()
  if (await countActiveAdministrators(providers, change, catalog) > 0) return true
  if (await countActiveAdministrators(providers, undefined, catalog) === 0) return false
  throw lastAdministrator()
}

/** How many times a change that left nobody able to manage roles is undone before giving up. */
const MAX_UNDO_ATTEMPTS = 3

/**
 * Applies `mutation` so that `change` cannot leave the system without an administrator, even
 * against a concurrent request: the rule is checked before writing, and after writing the
 * administrators are counted again; if two requests each passed its own check and together removed
 * the last one, the write is undone and refused. Used by every path that can do that (account
 * roles, role edits and deletes, account status, permission deactivation).
 *
 * `@zanix/datamaster`'s transactions need a replica set and cover one collection, not this
 * read-check-write over `roles`, `auth`, `users` and `permissions`, so they are not used. What
 * remains: the system can show no administrator for the instant between that write and its undo,
 * and a change whose undo cannot be applied (its target changed again) is reported as such.
 *
 * `catalog` is the role catalog as the caller already read it, reused for the check before the
 * write; the count after the write always reads it again.
 *
 * @returns `false` when `mutation.write` reported that its target changed since it was read, with
 *   nothing written; the caller decides whether to read again.
 * @throws {HttpError} `CONFLICT` (`LAST_ADMINISTRATOR`) when the change would, or did and was
 *   undone; `INTERNAL_SERVER_ERROR` (`LAST_ADMINISTRATOR_UNDO_FAILED`) when it did and could not be.
 */
export async function changeProtectingAdministrator(
  providers: Providers,
  change: AdministrationChange,
  mutation: AdministrationMutation,
  catalog?: PopulatedRoleDoc[],
): Promise<boolean> {
  const protectedAdministrator = await assertAdministratorRemains(providers, change, catalog)
  if (!await mutation.write()) return false
  if (!protectedAdministrator || await countActiveAdministrators(providers) > 0) return true

  for (let attempt = 1; attempt <= MAX_UNDO_ATTEMPTS; attempt++) {
    // deno-lint-ignore no-await-in-loop
    if (await mutation.undo()) throw lastAdministrator()
    // The target changed again. Someone else may have restored an administrator meanwhile.
    // deno-lint-ignore no-await-in-loop
    if (await countActiveAdministrators(providers) > 0) return true
  }
  throw new HttpError('INTERNAL_SERVER_ERROR', {
    message: 'This change left no account able to manage roles and could not be undone. ' +
      'Restore an administrator manually.',
    code: IAM_ERROR_CODES.lastAdministratorUndoFailed,
    shouldLog: true,
  })
}
