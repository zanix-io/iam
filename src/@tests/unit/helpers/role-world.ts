import { AuditService } from 'server/interactors/audit.interactor.ts'
import { PermissionsService } from 'server/interactors/permissions.interactor.ts'
import { RolesService } from 'server/interactors/roles.interactor.ts'
import { UsersService } from 'server/interactors/users.interactor.ts'
import { AuditRepository } from 'server/repositories/audit/entity.provider.ts'
import { AuthRepository } from 'server/repositories/auth/entity.provider.ts'
import { PermissionsRepository } from 'server/repositories/permissions/entity.provider.ts'
import { RolesRepository } from 'server/repositories/roles/entity.provider.ts'
import { UsersRepository } from 'server/repositories/users/entity.provider.ts'
import { emailLookupCandidates } from 'server/repositories/auth/email-key.ts'
import { blocksSignIn, RBAC_PERMISSIONS } from 'utils/constants.ts'
import { mapGetter, mockAccessor } from './mock.ts'
import type { HttpError } from '@zanix/errors'

/**
 * A small in-memory world (roles, permissions, accounts, profiles) behind fakes of the four
 * repositories that role administration reads and writes, so a test states a scenario ("two
 * accounts hold the administrator role, one is inactive") and asserts on the resulting state. The
 * fakes follow the real repositories' contracts, including the conditional writes
 * (`replaceRoleIds`/`pullRoleIds`) that answer `false` when the account changed under the caller.
 */

export type FakePermission = { id: string; code: string; isActive: boolean; updatedAt?: Date }
export type FakeRole = {
  id: string
  name: string
  code: string
  description: string
  tenantId?: string
  isSystem?: boolean
  updatedAt?: Date
  permissions: FakePermission[]
}
export type FakeAccount = { id: string; userId?: string; roleIds?: string[]; email?: string }

/** A permission with a stable id derived from its code. */
export const perm = (code: string, isActive = true): FakePermission => ({
  id: `p-${code}`,
  code,
  isActive,
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
})

export const role = (
  id: string,
  permissions: FakePermission[],
  tenantId?: string,
): FakeRole => ({
  id,
  name: id,
  code: id,
  description: id,
  tenantId,
  permissions,
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
})

export const ROLE_WRITE = RBAC_PERMISSIONS.roleWrite

/** `role-write` plus one ordinary permission. */
export const ADMIN_ROLE = role('role-admin', [perm(ROLE_WRITE), perm('web:user')])
export const ROOT_ROLE = role('role-root', [perm('*')])
export const USER_ROLE = role('role-user', [perm('web:user')])
export const SELLER_ROLE = role('role-seller', [perm('seller:manage')])

export type WorldInit = {
  roles?: FakeRole[]
  accounts?: FakeAccount[]
  /** Permissions in the catalog that no role carries (by default the catalog is the roles'). */
  permissions?: FakePermission[]
  /** Profile status by `userId`. */
  profiles?: Record<string, string>
  /**
   * The caller. A `user` session by default. If `accounts` has an account with this `subject` it is
   * the caller; otherwise the world creates one (with an ACTIVE profile) that holds a role of its
   * own carrying the permission codes in `scope` (`'*'` included), none when `scope` is absent.
   * That account counts as an administrator whenever its scope holds `role-write` or `*`, as a real
   * one would. `type: 'api'` is a service credential (no account at all) and `missing: true` a
   * `user` session whose account does not exist.
   */
  session?: { subject: string; scope?: string[]; type?: 'user' | 'api'; missing?: boolean }
  /** Makes opening an audit event fail, as an unavailable audit store would. */
  failAudit?: boolean
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index])

export function buildWorld(init: WorldInit = {}) {
  const state = {
    // A copy, so a test that edits a role never changes the shared fixtures.
    roles: structuredClone(init.roles ?? [ADMIN_ROLE, ROOT_ROLE, USER_ROLE, SELLER_ROLE]),
    accounts: structuredClone(init.accounts ?? []),
    profiles: { ...init.profiles },
    extraPermissions: structuredClone(init.permissions ?? []),
    writes: [] as unknown[][],
    created: [] as unknown[],
    createdPermissions: [] as unknown[],
    updatedRoles: [] as unknown[],
    deletedRoles: [] as string[],
    restoredRoles: [] as unknown[],
    updatedPermissions: [] as unknown[],
    updatedUsers: [] as unknown[],
    /** The audit trail, in the order events were opened. */
    audit: [] as Record<string, unknown>[],
    /** Runs right before a conditional write checks the account, to simulate a concurrent change. */
    beforeConditionalWrite: undefined as undefined | ((authId: string) => void),
    /** Runs right before a role is updated, to simulate an edit by someone else. */
    beforeRoleWrite: undefined as undefined | (() => void),
    /** Runs right after a role, profile or permission edit is written and before the recount. */
    afterWrite: undefined as undefined | (() => void),
    findRoleQueries: [] as string[][],
    /** How many times the whole role catalog was read. */
    catalogReads: 0,
  }
  const callerSession = init.session ?? { subject: 'caller', scope: ['*'] }
  if (
    callerSession.type !== 'api' && !callerSession.missing &&
    !state.accounts.some((entry) => entry.id === callerSession.subject)
  ) {
    const roleId = `role-actor-${callerSession.subject}`
    const scope = callerSession.scope ?? []
    if (scope.length) state.roles.push(role(roleId, scope.map((code) => perm(code))))
    state.accounts.push({
      id: callerSession.subject,
      userId: `user-${callerSession.subject}`,
      roleIds: scope.length ? [roleId] : [],
    })
    state.profiles[`user-${callerSession.subject}`] = 'ACTIVE'
  }
  const account = (id: string) => state.accounts.find((entry) => entry.id === id)
  const catalog = new Map<string, FakePermission>()
  for (const entry of [...state.roles.flatMap((r) => r.permissions), ...state.extraPermissions]) {
    if (!catalog.has(entry.id)) catalog.set(entry.id, entry)
  }
  /** Every object representing the permission `id`: the catalog's and each role's copy. */
  const copiesOf = (id: string) =>
    [
      catalog.get(id),
      ...state.roles.flatMap((r) => r.permissions.filter((p) => p.id === id)),
    ].filter((p): p is FakePermission => Boolean(p))
  const tick = (date?: Date) => new Date((date?.getTime() ?? 0) + 1000)

  const authRepo = {
    findById: (id: string) => {
      if (id.startsWith('not-an-object-id')) {
        return Promise.reject(
          Object.assign(new Error('Cast to ObjectId failed'), { name: 'CastError' }),
        )
      }
      const found = account(id)
      return found ? { ...found, roleIds: found.roleIds && [...found.roleIds] } : undefined
    },
    /** Exact match on the stored address, over the same spellings the real lookup tries. */
    findByEmailForLookup: (email: string) => {
      for (const candidate of emailLookupCandidates(email)) {
        const found = state.accounts.find((entry) => entry.email === candidate)
        if (found) return { ...found, roleIds: found.roleIds && [...found.roleIds] }
      }
      return null
    },
    findByUserId: (userId: string) => state.accounts.find((entry) => entry.userId === userId),
    findRolesByUserIds: (userIds: string[]) =>
      state.accounts
        .filter((entry) => entry.userId && userIds.includes(entry.userId))
        .map((entry) => ({
          id: entry.id,
          userId: entry.userId,
          roleIds: [...entry.roleIds ?? []],
        })),
    countHolders: (roleId: string) =>
      state.accounts.filter((entry) => entry.roleIds?.includes(roleId)).length,
    searchHolders: (roleId: string, options: { page?: number; limit?: number } = {}) => {
      const all = state.accounts.filter((entry) => entry.roleIds?.includes(roleId))
      const limit = options.limit ?? 10
      const page = options.page ?? 1
      return {
        total: all.length,
        page,
        limit,
        docs: all.slice((page - 1) * limit, page * limit).map((e) => ({
          id: e.id,
          userId: e.userId,
        })),
      }
    },
    addRoleIds: (id: string, ids: string[]) => {
      const found = account(id)
      if (found) found.roleIds = [...new Set([...(found.roleIds ?? []), ...ids])]
      state.writes.push(['add', id, ids])
      return {}
    },
    replaceRoleIds: (id: string, expected: string[], next: string[]) => {
      state.beforeConditionalWrite?.(id)
      const found = account(id)
      if (!found || !sameList(found.roleIds ?? [], expected)) return false
      found.roleIds = [...next]
      state.writes.push(['replace', id, next])
      return true
    },
    pullRoleIds: (id: string, expected: string[], ids: string[]) => {
      state.beforeConditionalWrite?.(id)
      const found = account(id)
      if (!found || !sameList(found.roleIds ?? [], expected)) return false
      found.roleIds = (found.roleIds ?? []).filter((entry) => !ids.includes(entry))
      state.writes.push(['pull', id, ids])
      return true
    },
    findHoldersOfRoleIds: (ids: string[], except?: string) =>
      state.accounts
        .filter((entry) =>
          entry.id !== except && (entry.roleIds ?? []).some((r) => ids.includes(r))
        )
        .map((entry) => ({ id: entry.id, userId: entry.userId })),
  }

  const rolesRepo = {
    findById: (id: string, options: { populate?: string } = {}) => {
      const found = state.roles.find((entry) => entry.id === id)
      if (!found) return undefined
      return options.populate
        ? found
        : { ...found, permissions: found.permissions.map((p) => p.id) }
    },
    findManyByIds: (ids: string[]) => state.roles.filter((entry) => ids.includes(entry.id)),
    findManyWithPermissions: (ids: string[]) => {
      state.findRoleQueries.push(ids)
      return state.roles.filter((entry) => ids.includes(entry.id))
    },
    findAllWithPermissions: () => {
      state.catalogReads++
      return [...state.roles]
    },
    findByCode: (code: string, tenantId?: string) =>
      state.roles.find((entry) => entry.code === code && entry.tenantId === tenantId),
    createRole: (data: unknown) => {
      state.created.push(data)
      return { id: `role-new-${state.created.length}` }
    },
    updateRole: (
      data: { id: string; name?: string; description?: string; permissions?: string[] },
      options: { ifUpdatedAt?: Date } = {},
    ) => {
      state.beforeRoleWrite?.()
      const found = state.roles.find((entry) => entry.id === data.id)
      if (!found) return false
      if (options.ifUpdatedAt && options.ifUpdatedAt.getTime() !== found.updatedAt?.getTime()) {
        return false
      }
      state.updatedRoles.push(data)
      if (data.name) found.name = data.name
      if (data.description) found.description = data.description
      if (data.permissions) {
        found.permissions = data.permissions.flatMap((id) => catalog.get(id) ?? [])
      }
      found.updatedAt = tick(found.updatedAt)
      state.afterWrite?.()
      return true
    },
    replacePermissions: (id: string, expected: string[], next: string[]) => {
      const found = state.roles.find((entry) => entry.id === id)
      if (!found || !sameList(found.permissions.map((p) => p.id), expected)) return false
      found.permissions = next.flatMap((permissionId) => catalog.get(permissionId) ?? [])
      return true
    },
    deleteRole: (id: string) => {
      state.deletedRoles.push(id)
      state.roles = state.roles.filter((entry) => entry.id !== id)
      state.afterWrite?.()
    },
    restoreRole: (snapshot: { id: string; permissions?: string[] } & Partial<FakeRole>) => {
      if (state.roles.some((entry) => entry.id === snapshot.id)) return false
      state.restoredRoles.push(snapshot)
      state.roles.push({
        ...(snapshot as FakeRole),
        permissions: (snapshot.permissions as unknown as string[]).flatMap((id) =>
          catalog.get(id) ?? []
        ),
      })
      return true
    },
    searchRoles: (options: unknown) => ({ docs: [], total: 0, options }),
  }

  const permissionsRepo = {
    findById: (id: string) => catalog.get(id),
    findManyByIds: (ids: string[]) => ids.flatMap((id) => catalog.get(id) ?? []),
    createPermission: (data: unknown) => {
      state.createdPermissions.push(data)
      return { id: `p-new-${state.createdPermissions.length}` }
    },
    findByCode: (code: string) => [...catalog.values()].find((entry) => entry.code === code),
    updatePermission: (
      data: { id: string; isActive?: boolean },
      options: { ifUpdatedAt?: Date } = {},
    ) => {
      const found = catalog.get(data.id)
      if (!found) return false
      if (options.ifUpdatedAt && options.ifUpdatedAt.getTime() !== found.updatedAt?.getTime()) {
        return false
      }
      state.updatedPermissions.push(data)
      for (const copy of copiesOf(data.id)) {
        if (data.isActive !== undefined) copy.isActive = data.isActive
        copy.updatedAt = tick(copy.updatedAt)
      }
      state.afterWrite?.()
      return true
    },
    restoreActive: (id: string, expected: boolean, previous: boolean) => {
      if (catalog.get(id)?.isActive !== expected) return false
      for (const copy of copiesOf(id)) copy.isActive = previous
      return true
    },
  }

  const usersRepo = {
    findById: (id: string) =>
      id in state.profiles
        ? { id, status: state.profiles[id], firstName: `Name ${id}` }
        : undefined,
    findManyByIds: (ids: string[]) =>
      ids.filter((id) => id in state.profiles).map((id) => ({
        id,
        status: state.profiles[id],
        firstName: `Name ${id}`,
        lastName: 'Surname',
      })),
    findSignInBlockedIds: (ids: string[]) =>
      new Set(ids.filter((id) => id in state.profiles && blocksSignIn(state.profiles[id]))),
    updateUser: (data: { id: string; status?: string }) => {
      state.updatedUsers.push(data)
      if (data.status) state.profiles[data.id] = data.status
      state.afterWrite?.()
    },
    restoreStatus: (id: string, expected: string, previous: string) => {
      if (state.profiles[id] !== expected) return false
      state.profiles[id] = previous
      return true
    },
    searchUsers: () => ({
      total: Object.keys(state.profiles).length,
      docs: Object.keys(state.profiles).map((id) => ({ id, status: state.profiles[id] })),
    }),
  }

  const auditRepo = {
    begin: (event: Record<string, unknown>) => {
      if (init.failAudit) throw new Error('[test] the audit store is down')
      const id = `audit-${state.audit.length + 1}`
      state.audit.push({ id, ...event, result: 'pending' })
      return id
    },
    finish: (id: string, result: string, details: Record<string, unknown> = {}) => {
      const found = state.audit.find((entry) => entry.id === id)
      if (!found) return
      const { targetId, ...rest } = details as { targetId?: string }
      Object.assign(found, { result }, rest)
      if (targetId) found.target = { ...(found.target as object), id: targetId }
    },
    searchEvents: (options: Record<string, unknown>) => ({ docs: state.audit, total: 0, options }),
  }

  const providers = mapGetter([
    [AuthRepository, authRepo],
    [RolesRepository, rolesRepo],
    [PermissionsRepository, permissionsRepo],
    [UsersRepository, usersRepo],
    [AuditRepository, auditRepo],
  ])
  const session = callerSession

  function mount<T extends object>(service: T): T {
    mockAccessor(service, 'providers', providers)
    mockAccessor(service, 'context', {
      id: 'req-1',
      session: { subject: session.subject, scope: session.scope, type: session.type ?? 'user' },
    })
    return service
  }

  return {
    state,
    roles: mount(new RolesService('ctx')),
    users: mount(new UsersService('ctx')),
    permissions: mount(new PermissionsService('ctx')),
    audit: mount(new AuditService('ctx')),
    account,
    providers,
    /** A role as the world holds it now. */
    roleById: (id: string) => {
      const found = state.roles.find((entry) => entry.id === id)
      if (!found) throw new Error(`[test] no role ${id}`)
      return found
    },
    /** Sets an account's roles directly, as a concurrent request would. */
    setRolesDirectly: (id: string, roleIds: string[]) => {
      const found = account(id)
      if (!found) throw new Error(`[test] no account ${id}`)
      found.roleIds = roleIds
    },
    /** The audit events recorded for `action`, in order. */
    events: (action: string) => state.audit.filter((entry) => entry.action === action),
  }
}

/** The error a call rejects with, for a test to inspect its status, `code` and `meta`. */
export async function rejection(run: () => Promise<unknown>): Promise<HttpError> {
  try {
    await run()
  } catch (error) {
    return error as HttpError
  }
  throw new Error('[test] expected the call to reject')
}
