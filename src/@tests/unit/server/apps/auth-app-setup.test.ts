import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError, InternalError } from '@zanix/errors'
import { getResourceFactory } from '@zanix/app/runtime'
import { TemplatesAdminRepository } from '@zanix/notifications'

import authApp from 'server/apps/auth.app.ts'
import { fn } from '../../helpers/mock.ts'

/**
 * `auth.app.ts`'s `setup` seeds the project-specific `totp-enabled` email template through
 * `ctx.resolve(TemplatesAdminRepository)`; a fake `ctx.resolve` stands in for the repository, so
 * no database is involved. Also covers the `captcha-provider` resource factory's guard against
 * being invoked with no captcha provider configured.
 */

// deno-lint-ignore no-explicit-any
const setup = authApp.definition.setup as (ctx: any) => Promise<void>

/** Runs `run` with `TEMPLATES_BACKEND` set to `value` (`undefined` unsets it), then puts it back. */
async function withBackend<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const original = Deno.env.get('TEMPLATES_BACKEND')
  if (value === undefined) Deno.env.delete('TEMPLATES_BACKEND')
  else Deno.env.set('TEMPLATES_BACKEND', value)
  try {
    return await run()
  } finally {
    if (original === undefined) Deno.env.delete('TEMPLATES_BACKEND')
    else Deno.env.set('TEMPLATES_BACKEND', original)
  }
}

function setupContext(create: (...args: unknown[]) => unknown) {
  const resolved: unknown[] = []
  const ctx = {
    resolve: (Target: unknown) => {
      resolved.push(Target)
      return { create }
    },
  }
  return { ctx, resolved }
}

Deno.test('auth.app.ts setup: seeds the totp-enabled email template as the system actor', async () => {
  const create = fn((..._args: unknown[]) => ({}))
  const { ctx, resolved } = setupContext(create)
  await withBackend('local', () => setup(ctx))

  assertEquals(resolved, [TemplatesAdminRepository])
  const [template, actor] = create.calls[0] as [Record<string, string>, string]
  assertEquals(actor, 'system')
  assertEquals([template.channel, template.name], ['email', 'totp-enabled'])
  assert(template.hbs.includes('Two-factor authentication enabled'))
  assert(template.description.length > 0)
})

Deno.test('auth.app.ts setup: without TEMPLATES_BACKEND=local nothing is resolved or seeded', async () => {
  for (const value of [undefined, '']) {
    const create = fn((..._args: unknown[]) => ({}))
    const { ctx, resolved } = setupContext(create)
    // deno-lint-ignore no-await-in-loop
    await withBackend(value, () => setup(ctx))
    assertEquals([resolved, create.calls], [[], []])
  }
})

Deno.test('auth.app.ts setup: an already-seeded template (CONFLICT) is not an error', async () => {
  const { ctx } = setupContext(() => {
    throw new HttpError('CONFLICT', { message: 'Template already exists.' })
  })
  await withBackend('local', () => setup(ctx))
})

Deno.test('auth.app.ts setup: any other HttpError from the repository propagates', async () => {
  const { ctx } = setupContext(() => {
    throw new HttpError('INTERNAL_SERVER_ERROR', { message: 'Database unavailable.' })
  })
  await assertRejects(
    () => withBackend('local', () => setup(ctx)),
    HttpError,
    'Database unavailable.',
  )
})

Deno.test('auth.app.ts setup: a non-HttpError failure propagates', async () => {
  const { ctx } = setupContext(() => {
    throw new TypeError('boom')
  })
  await assertRejects(() => withBackend('local', () => setup(ctx)), TypeError, 'boom')
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
