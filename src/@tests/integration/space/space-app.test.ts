import { assertEquals, assertStrictEquals } from 'jsr:@std/assert@0.224'
import { getBootstrapSpaceAppConfig, getUserPreHandler } from '@zanix/space'

import iamSpaceApp from '../../../../space.app.ts'

/**
 * `space.app.ts` wired into the real `@zanix/space` runtime: the app manifest it defines and the
 * bootstrap SSR config it registers at import time. Nothing mocked (Pattern A in
 * `zanix-test-tier-conventions`).
 */

const definition = iamSpaceApp.definition

Deno.test('space.app.ts: defines the "iam" space app with a single loginHeading behavior slot', () => {
  assertEquals(definition.name, 'iam')
  assertEquals(Object.keys(definition.behaviors), ['loginHeading'])
  assertEquals(typeof iamSpaceApp.serve, 'function')
})

Deno.test("space.app.ts: loginHeading's default is the 'Sign in' heading, with a description for hosts", () => {
  const slot = definition.behaviors.loginHeading
  assertEquals((slot.default as () => string)(), 'Sign in')
  assertEquals(typeof slot.description, 'string')
})

Deno.test('space.app.ts: registers the bootstrap SSR config (error handler, request on errors, user pre-handler)', () => {
  const ssr = getBootstrapSpaceAppConfig().server?.ssr
  assertEquals(typeof ssr?.onError, 'function')
  assertEquals(ssr?.attachRequestToErrors, true)
  // `getUserPreHandler()` returns the single pre-handler `src/space/middleware.ts` registers,
  // which space.app.ts imports for that side effect before reading it.
  assertStrictEquals(ssr?.preHandler, getUserPreHandler())
})
