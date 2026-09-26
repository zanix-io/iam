import { assert, assertEquals, assertStrictEquals } from 'jsr:@std/assert@0.224'

import grantAccessApp from 'server/apps/grant-access.app.ts'
import { defaultEvaluateGrantAccess } from 'utils/grant-access.ts'

/**
 * Pure-function coverage for `grant-access.app.ts`'s `behaviors.evaluateGrantAccess.default` —
 * same pattern as `auth-app-behaviors.test.ts`. The real, WIRED path
 * (`resolveBehavior('grant-access', 'evaluateGrantAccess')` after a host activates this app, or a
 * host's own override) is covered via `GrantAccessService.checkAccess`'s own call site
 * (`unit/server/interactors/grant-access.service.test.ts`) and the manifest-shape assertion in
 * `integration/server/apps/grant-access-app.test.ts`.
 */

Deno.test('evaluateGrantAccess: registered as the real utils/grant-access.ts implementation, not a copy', () => {
  // A real identity check (`===`), not just behavioral equivalence — same reasoning as
  // `auth-app-behaviors.test.ts`'s own `resolveEffectivePermissions` assertion.
  assertStrictEquals(
    grantAccessApp.definition.behaviors.evaluateGrantAccess.default,
    defaultEvaluateGrantAccess,
  )
})

Deno.test('checkAccess operation: registered, public (no allowedCallers restriction)', () => {
  const operation = grantAccessApp.definition.operations.checkAccess
  assertEquals(typeof operation.handler, 'function')
  assertEquals(operation.allowedCallers, null)
})

Deno.test('checkAccess operation: resolves GrantAccessService and returns its checkAccess result for the payload', async () => {
  const { GrantAccessService } = await import('server/interactors/grant-access.interactor.ts')
  const original = GrantAccessService.prototype.checkAccess
  const received: unknown[] = []
  GrantAccessService.prototype.checkAccess = (payload: unknown) => {
    received.push(payload)
    return Promise.resolve({ allowed: true })
  }
  try {
    const payload = { userId: 'user-1', resourceId: 'billing:reports', accessLevel: 'read' }
    const handler = grantAccessApp.definition.operations.checkAccess.handler
    assert(handler, 'checkAccess must declare a handler')
    const result = await handler(payload, {} as never)
    assertEquals(result, { allowed: true })
    assertEquals(received, [payload])
  } finally {
    GrantAccessService.prototype.checkAccess = original
  }
})
