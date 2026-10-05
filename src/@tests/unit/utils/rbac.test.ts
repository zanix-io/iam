import { assertEquals } from 'jsr:@std/assert@0.224'
import { missingScopes } from '@zanix/auth'

import { effectiveRoleIds, resolveEffectivePermissions, unionPermissions } from 'utils/rbac.ts'

/**
 * Pure-function coverage for `resolveEffectivePermissions` — the default RBAC evaluation
 * strategy registered as `auth.app.ts`'s own `resolveEffectivePermissions` behavior default. The
 * real, WIRED path (`resolveBehavior('auth', 'resolveEffectivePermissions')` after a host
 * activates the app) is exercised indirectly via `AuthService`/`PasswordService`'s own
 * `resolveSessionPermissions` call sites, covered in their own interactor test files, plus the
 * manifest-shape assertion in `integration/server/apps/auth-app.test.ts`.
 */

Deno.test('resolveEffectivePermissions: no role returns an empty list', () => {
  assertEquals(resolveEffectivePermissions(undefined), [])
  assertEquals(resolveEffectivePermissions(null), [])
})

Deno.test('resolveEffectivePermissions: a role with no permissions returns an empty list', () => {
  assertEquals(
    resolveEffectivePermissions({ id: 'role-1', permissions: [] } as never),
    [],
  )
})

Deno.test('resolveEffectivePermissions: flattens active permissions to their codes', () => {
  const role = {
    id: 'role-1',
    permissions: [
      { id: 'p1', code: 'zanix-iam:role-read', isActive: true },
      { id: 'p2', code: 'zanix-iam:role-write', isActive: true },
    ],
  }
  assertEquals(
    resolveEffectivePermissions(role as never),
    ['zanix-iam:role-read', 'zanix-iam:role-write'],
  )
})

Deno.test('resolveEffectivePermissions: drops inactive permissions', () => {
  const role = {
    id: 'role-1',
    permissions: [
      { id: 'p1', code: 'zanix-iam:role-read', isActive: true },
      { id: 'p2', code: 'zanix-iam:role-write', isActive: false },
    ],
  }
  assertEquals(resolveEffectivePermissions(role as never), ['zanix-iam:role-read'])
})

Deno.test('resolveEffectivePermissions: the wildcard code is returned as-is, no special-casing', () => {
  const role = { id: 'role-1', permissions: [{ id: 'p1', code: '*', isActive: true }] }
  assertEquals(resolveEffectivePermissions(role as never), ['*'])
})

Deno.test('effectiveRoleIds: reads roleIds as strings without repeats', () => {
  assertEquals(effectiveRoleIds({ roleIds: ['r1', { toString: () => 'r2' }, 'r1'] }), ['r1', 'r2'])
})

Deno.test('effectiveRoleIds: no account or no roleIds is empty', () => {
  assertEquals(effectiveRoleIds(undefined), [])
  assertEquals(effectiveRoleIds(null), [])
  assertEquals(effectiveRoleIds({}), [])
  assertEquals(effectiveRoleIds({ roleIds: [] }), [])
})

Deno.test('unionPermissions: merges lists without repeats, in first-seen order', () => {
  assertEquals(unionPermissions([['a', 'b'], ['b', 'c'], []]), ['a', 'b', 'c'])
  assertEquals(unionPermissions([]), [])
})

Deno.test('missingScopes (the grant rule): a held code covers itself, * covers everything, nothing covers *', () => {
  assertEquals(missingScopes(['a:read'], ['a:read', 'a:write']), [])
  assertEquals(missingScopes(['a:read', 'b:write', 'b:write'], ['a:read']), ['b:write'])
  assertEquals(missingScopes(['a:read', '*', 'b:write'], ['*']), [])
  assertEquals(missingScopes(['*'], ['a:read', 'b:write']), ['*'])
})

Deno.test('missingScopes (the grant rule): no held permissions covers nothing, nothing required needs nothing', () => {
  assertEquals(missingScopes(['a:read'], undefined), ['a:read'])
  assertEquals(missingScopes(['a:read'], []), ['a:read'])
  assertEquals(missingScopes([], undefined), [])
})

Deno.test('missingScopes (the grant rule): no prefix wildcards, order of first appearance, any iterable', () => {
  assertEquals(missingScopes(['iam:read'], ['iam:*']), ['iam:read'])
  assertEquals(missingScopes(['b:x', 'a:x', 'b:x'], []), ['b:x', 'a:x'])
  assertEquals(missingScopes(new Set(['a:x', 'b:x']), new Set(['a:x'])), ['b:x'])
})
