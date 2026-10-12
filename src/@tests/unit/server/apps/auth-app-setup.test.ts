import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { InternalError } from '@zanix/errors'
import { getResourceFactory } from '@zanix/app/runtime'

import authApp from 'server/apps/auth.app.ts'

/**
 * `auth.app.ts` no longer seeds the `totp-enabled` email template from a `setup`: it registers it,
 * with its words, with `@zanix/notifications` (`registerTemplateSeeds`), which syncs it into the
 * templates collection like its own built-ins. Also covers the `captcha-provider` resource
 * factory's guard against being invoked with no captcha provider configured.
 */

Deno.test('auth.app.ts: nothing is seeded from a setup, the notifications sync owns the template', () => {
  // The app declares no `setup` of its own; the framework's default is not a function.
  assertEquals(typeof authApp.definition.setup === 'function', false)
})

Deno.test('auth.app.ts: the captcha-provider factory refuses to build with no captcha provider configured', async () => {
  const factory = getResourceFactory('captcha-provider')
  assert(factory, 'captcha-provider factory must be registered')
  await assertRejects(
    async () => await factory({}),
    InternalError,
    'resolved with no provider configured',
  )
})
