import { assertEquals } from 'jsr:@std/assert@0.224'

import { resolveEffectivePermissions } from 'utils/rbac.ts'

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
