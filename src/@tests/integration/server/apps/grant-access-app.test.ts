import { assertEquals } from 'jsr:@std/assert@0.224'

import grantAccessApp from 'server/apps/grant-access.app.ts'

/**
 * Real-registration checks ("is this artifact actually wired into the real system", per
 * `zanix-test-tier-conventions`' Pattern A) — nothing mocked here, unlike the unit-tier interactor
 * tests. Same shape as `auth-app.test.ts`.
 */

Deno.test('grant-access.app.ts: manifest shape — no HTTP surface, only the declared slots', () => {
  const def = grantAccessApp.definition
  assertEquals(def.name, 'grant-access')
  assertEquals(def.routesPrefix, null)
  assertEquals(Object.keys(def.dependencies).sort(), [])
  assertEquals(Object.keys(def.behaviors).sort(), ['evaluateGrantAccess'])
  assertEquals(Object.keys(def.operations).sort(), ['checkAccess'])
})
