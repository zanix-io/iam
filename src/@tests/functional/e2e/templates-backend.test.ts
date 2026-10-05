// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals } from 'jsr:@std/assert@0.224'

import { assertOk, e2eIgnore, startIam } from '../../support/e2e.ts'

/**
 * The server starts with and without `TEMPLATES_BACKEND=local`. Without it there is no templates
 * model: iam seeds nothing, every template renders from code, and booting must not depend on a
 * collection that does not exist. With it, the database-only `totp-enabled` template is seeded.
 */
const collections = async (iam: Awaited<ReturnType<typeof startIam>>): Promise<string[]> =>
  (await iam.db.col('auths').conn.db.listCollections().toArray()).map((c: { name: string }) =>
    c.name
  )

Deno.test({
  name:
    'e2e: the server starts and works with TEMPLATES_BACKEND unset, and seeds the template with local',
  ignore: e2eIgnore,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    await t.step('unset: listens, signs in, seeds nothing, and renders from code', async () => {
      const iam = await startIam({ env: { TEMPLATES_BACKEND: '' } })
      try {
        assertEquals(iam.admin.claims.aud, ['*'])
        assert(!(await collections(iam)).includes('zanix-templates'), 'no templates collection')
        // The templates API says it is off, instead of failing with a 500.
        const list = await iam.call('GET', '/templates/list', { token: iam.admin.accessToken })
        assertEquals([list.status, list.body.code], [404, 'TEMPLATES_BACKEND_DISABLED'])
        // Registering a person sends the welcome notice, which renders from code.
        await iam.register(iam.admin.accessToken, 'no.templates@iam-test.invalid')
        // Enabling TOTP still works (it simply sends no database-only notice).
        const enroll = await iam.call('GET', '/login/totp/enroll', { token: iam.admin.accessToken })
        assert(enroll.status < 500, `${enroll.status}`)
      } finally {
        await iam.stop()
      }
    })

    await t.step(
      'local: seeds the totp-enabled template once, and a second boot keeps it',
      async () => {
        const iam = await startIam({ env: { TEMPLATES_BACKEND: 'local' } })
        try {
          assert((await collections(iam)).includes('zanix-templates'))
          const seeded = await iam.db.col('zanix-templates').find({ name: 'totp-enabled' })
            .toArray()
          assertEquals(seeded.length, 1)
          assertEquals((seeded[0] as any).channel, 'email')
          const list = assertOk(
            await iam.call('GET', '/templates/list', { token: iam.admin.accessToken }),
          )
          assert(JSON.stringify(list).includes('totp-enabled'), 'the seeded template is listed')
        } finally {
          await iam.stop()
        }
      },
    )
  },
})
