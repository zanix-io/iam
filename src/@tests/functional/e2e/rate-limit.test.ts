// deno-lint-ignore-file no-await-in-loop
import { assertEquals } from 'jsr:@std/assert@0.224'

import { RBAC_PERMISSIONS } from 'utils/constants.ts'
import { assertOk, e2eIgnore, FIRST_ADMIN, startIam, toolbox } from '../../support/e2e.ts'

/**
 * The rate limit of administration mutations changes what a client gets back: after
 * `ADMIN_MUTATION_RATELIMIT` mutations in the window, the next one is a 429, whatever token it
 * carries, while reads and other operators are untouched. The limit is low here through the
 * environment of the server under test.
 */
const P = RBAC_PERMISSIONS
const LIMIT = 4

Deno.test({
  name: 'e2e: administration mutations are limited per operator, across tokens and routes',
  ignore: e2eIgnore,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const iam = await startIam({
      env: {
        ADMIN_MUTATION_RATELIMIT: String(LIMIT),
        ADMIN_MUTATION_RATELIMIT_WINDOW_SECONDS: '60',
      },
    })
    const tools = toolbox(iam)
    try {
      const id = await tools.permissionId(P.auditRead)
      const edit = (token: string, text: string) =>
        iam.call('PATCH', `/permissions/${id}`, { token, body: { description: text } })

      await t.step(
        `the first ${LIMIT} mutations of an operator pass and the next is a 429`,
        async () => {
          for (let n = 1; n <= LIMIT; n++) {
            assertOk(await edit(iam.admin.accessToken, `Edit ${n}`))
          }
          const limited = await edit(iam.admin.accessToken, 'One too many')
          assertEquals(limited.status, 429)
          assertEquals(limited.headers.has('retry-after'), true)
          assertEquals(
            assertOk(await iam.call('GET', `/permissions/${id}`, { token: iam.admin.accessToken }))
              .description,
            `Edit ${LIMIT}`,
            'the refused mutation changed nothing',
          )
        },
      )

      await t.step('a new token of the same operator (a new login) shares the bucket', async () => {
        const fresh = await iam.login(FIRST_ADMIN.email, FIRST_ADMIN.password)
        assertEquals(fresh.claims.sub, iam.admin.claims.sub)
        assertEquals((await edit(fresh.accessToken, 'Another token')).status, 429)
        const refreshed = await iam.refresh(fresh)
        assertEquals((await edit(refreshed.accessToken, 'Refreshed token')).status, 429)
      })

      await t.step(
        'other routes with the limit share the same bucket; reads are not limited',
        async () => {
          const create = await iam.call('POST', '/permissions', {
            token: iam.admin.accessToken,
            body: { code: 'limited:create', name: 'n', description: 'd' },
          })
          assertEquals(create.status, 429)
          for (let n = 0; n < 10; n++) {
            assertOk(await iam.call('GET', '/permissions', { token: iam.admin.accessToken }))
          }
        },
      )

      await t.step('another operator has a bucket of their own', async () => {
        // Registering is not limited (it is not one of the limited mutations), so this uses the
        // first administrator's bucket-free routes to set the second operator up.
        const role = await iam.db.col('roles').findOne({ code: 'superadmin' })
        const second = await iam.register(iam.admin.accessToken, 'second.operator@iam-test.invalid')
        await iam.db.col('auths').updateOne(
          { _id: iam.db.oid(second.authId) },
          { $set: { roleIds: [role._id] } },
        )
        const token = (await iam.login('second.operator@iam-test.invalid')).accessToken
        for (let n = 1; n <= LIMIT; n++) {
          assertOk(await edit(token, `Second ${n}`))
        }
        assertEquals((await edit(token, 'Second one too many')).status, 429)
      })
    } finally {
      await iam.stop()
    }
  },
})

Deno.test({
  name:
    'e2e: with RATE_LIMIT_PLANS defined, the administration limit is the figure configured, never a plan index',
  ignore: e2eIgnore,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // 3 is also a plan INDEX here (3:500): the explicit limit of the guard is never looked up there.
    const iam = await startIam({
      env: {
        ADMIN_MUTATION_RATELIMIT: '3',
        ADMIN_MUTATION_RATELIMIT_WINDOW_SECONDS: '60',
        RATE_LIMIT_PLANS: '3:500;9:3',
      },
    })
    try {
      const id = await toolbox(iam).permissionId(P.auditRead)
      const statuses: number[] = []
      for (let n = 1; n <= 5; n++) {
        const reply = await iam.call('PATCH', `/permissions/${id}`, {
          token: iam.admin.accessToken,
          body: { description: `Edit ${n}` },
        })
        statuses.push(reply.status)
      }
      assertEquals(statuses, [200, 200, 200, 429, 429])
    } finally {
      await iam.stop()
    }
  },
})
