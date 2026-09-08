import { assertEquals } from 'jsr:@std/assert@0.224'

import { defaultEvaluateGrantAccess } from 'utils/grant-access.ts'

/**
 * Pure-function coverage for `defaultEvaluateGrantAccess` — the default grant-evaluation strategy
 * registered as `grant-access.app.ts`'s own `evaluateGrantAccess` behavior default. The real,
 * WIRED path (`resolveBehavior('grant-access', 'evaluateGrantAccess')` after a host activates the
 * app) is exercised indirectly via `GrantAccessService.checkAccess`'s own call site, covered in
 * `unit/server/interactors/grant-access.service.test.ts`, plus the manifest-shape assertion in
 * `integration/server/apps/grant-access-app.test.ts`.
 */

const grant = (overrides: Record<string, unknown> = {}) => ({
  id: 'grant-1',
  userId: 'user-1',
  resourceId: 'billing:chargeInvoice',
  accessLevel: 'READ',
  isActive: true,
  grantedBy: 'admin-1',
  grantedAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
})

Deno.test('defaultEvaluateGrantAccess: no grant never satisfies anything', () => {
  assertEquals(defaultEvaluateGrantAccess(undefined, 'READ'), false)
  assertEquals(defaultEvaluateGrantAccess(null, 'READ'), false)
})

Deno.test('defaultEvaluateGrantAccess: an inactive grant never satisfies anything', () => {
  assertEquals(
    defaultEvaluateGrantAccess(grant({ accessLevel: 'MANAGE', isActive: false }), 'READ'),
    false,
  )
})

Deno.test('defaultEvaluateGrantAccess: an expired grant never satisfies anything', () => {
  const expired = grant({ accessLevel: 'MANAGE', expiresAt: new Date(Date.now() - 1000) })
  assertEquals(defaultEvaluateGrantAccess(expired, 'READ'), false)
})

Deno.test('defaultEvaluateGrantAccess: a future expiresAt still satisfies', () => {
  const stillValid = grant({ accessLevel: 'READ', expiresAt: new Date(Date.now() + 100_000) })
  assertEquals(defaultEvaluateGrantAccess(stillValid, 'READ'), true)
})

Deno.test('defaultEvaluateGrantAccess: exact-level match satisfies', () => {
  assertEquals(defaultEvaluateGrantAccess(grant({ accessLevel: 'WRITE' }), 'WRITE'), true)
})

Deno.test('defaultEvaluateGrantAccess: a higher level satisfies a lower requirement (MANAGE satisfies READ)', () => {
  assertEquals(defaultEvaluateGrantAccess(grant({ accessLevel: 'MANAGE' }), 'READ'), true)
})

Deno.test('defaultEvaluateGrantAccess: a lower level never satisfies a higher requirement (READ never satisfies WRITE)', () => {
  assertEquals(defaultEvaluateGrantAccess(grant({ accessLevel: 'READ' }), 'WRITE'), false)
})

Deno.test('defaultEvaluateGrantAccess: an unrecognized accessLevel falls back to exact equality', () => {
  const custom = grant({ accessLevel: 'CUSTOM_LEVEL' })
  assertEquals(defaultEvaluateGrantAccess(custom, 'CUSTOM_LEVEL'), true)
  assertEquals(defaultEvaluateGrantAccess(custom, 'READ'), false)
})

Deno.test('defaultEvaluateGrantAccess: an unrecognized required level falls back to exact equality', () => {
  assertEquals(defaultEvaluateGrantAccess(grant({ accessLevel: 'READ' }), 'CUSTOM_LEVEL'), false)
})
