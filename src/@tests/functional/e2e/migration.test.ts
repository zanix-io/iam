// deno-lint-ignore-file no-await-in-loop
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'

import {
  assertOk,
  assertRefused,
  e2eIgnore,
  markdownSteps,
  mongosh,
  mongoshAvailable,
  startIam,
  SUPERADMIN_ROLE_ID,
  toolbox,
} from '../../support/e2e.ts'

/**
 * The upgrade from 1.x, exactly as the CHANGELOG tells an operator to do it: a database that holds
 * 1.x documents (`roleId`, no `roleIds`, a `superadmin` without `isSystem`, roles written before the
 * new validation, role ids that point at nothing) is built behind the API's back, then every
 * command of "Upgrading from 1.x" is run in the real `mongosh`, taken from the CHANGELOG text itself
 * so the document and the test cannot drift apart. Needs `mongosh` on the PATH.
 */
const CHANGELOG = await Deno.readTextFile(new URL('../../../../CHANGELOG.md', import.meta.url))
const AUTHORIZATION = await Deno.readTextFile(
  new URL('../../../../docs/authorization.md', import.meta.url),
)
const steps = markdownSteps(CHANGELOG, '### Upgrading from 1.x')
const count = (output: string) => Number(output.split('\n').pop())
const DEAD_ROLE = '6a0000000000000000000dea'

Deno.test({
  name:
    'e2e: the documented upgrade from 1.x migrates a 1.x database and every command does what it says',
  ignore: e2eIgnore || !mongoshAvailable,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const iam = await startIam()
    const tools = toolbox(iam)
    const db = iam.dbName
    const shell = (script: string) => mongosh(db, script)
    try {
      await t.step('the CHANGELOG has the eight documented steps and the rollback', () => {
        assertEquals(
          Object.keys(steps).sort(),
          ['1', '2', '3', '4', '5', '6', '7', '8', 'Rolling back'].sort(),
        )
      })

      // ---- A 1.x database, built behind the API ----
      await tools.createPermission('shop:buy')
      const buyer = await tools.createRole('buyer', ['shop:buy'])
      const accounts: Record<string, { authId: string; userId: string }> = {}
      for (const name of ['legacy', 'half', 'nullrole', 'dangling', 'stringrole']) {
        accounts[name] = await iam.register(iam.admin.accessToken, `${name}@iam-test.invalid`)
      }
      const auths = iam.db.col('auths')
      const id = (name: string) => iam.db.oid(accounts[name].authId)
      // 1.x: one role in `roleId`, nothing in `roleIds`.
      await auths.updateOne({ _id: id('legacy') }, {
        $set: { roleId: iam.db.oid(buyer) },
        $unset: { roleIds: '' },
      })
      // Half migrated: both fields, and `roleIds` already holds a different list.
      await auths.updateOne({ _id: id('half') }, {
        $set: { roleId: iam.db.oid(buyer), roleIds: [iam.db.oid(SUPERADMIN_ROLE_ID)] },
      })
      // A `roleId` that is not an id.
      await auths.updateOne({ _id: id('nullrole') }, {
        $set: { roleId: null },
        $unset: { roleIds: '' },
      })
      // A role id that points at no role (a deleted role).
      await auths.updateOne({ _id: id('dangling') }, {
        $set: { roleIds: [iam.db.oid(buyer), iam.db.oid(DEAD_ROLE)] },
      })
      // An id stored as text.
      await auths.updateOne({ _id: id('stringrole') }, {
        $set: { roleId: buyer },
        $unset: { roleIds: '' },
      })
      // `superadmin` as 1.x left it, and two roles the new validation would reject.
      await iam.db.col('roles').updateOne(
        { _id: iam.db.oid(SUPERADMIN_ROLE_ID) },
        { $unset: { isSystem: '' } },
      )
      await iam.db.col('roles').insertMany([
        {
          name: 'x',
          code: 'Bad Code',
          description: 'Written long ago',
          permissions: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          name: 'Fine name',
          code: 'fine-code',
          description: 'Fine',
          permissions: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ])

      await t.step('without migrating, a 1.x account has no permissions at all', async () => {
        const legacy = await iam.login('legacy@iam-test.invalid')
        assertEquals(legacy.claims.aud, [])
        assertEquals(
          assertOk(
            await iam.call('GET', `/roles/accounts/${accounts.legacy.authId}`, {
              token: iam.admin.accessToken,
            }),
          ).roleIds,
          [],
        )
      })

      await t.step('step 1 counts what is there', async () => {
        const [withRole, notAnId] = steps['1'].split('\n').filter((line) => line.startsWith('db.'))
        assertEquals(count(await shell(withRole)), 4) // legacy, half, nullrole, stringrole
        assertEquals(count(await shell(notAnId)), 2) // nullrole, stringrole
        // The check of what they hold tells text from null.
        const kinds = await shell(
          steps['1'].split('\n').filter((line) => !line.startsWith('db.auths.countDocuments')).join(
            '\n',
          ),
        )
        assertStringIncludes(kinds, "_id: 'string'")
        assertStringIncludes(kinds, "_id: 'null'")
      })

      await t.step('step 2 turns an id stored as text into an id, and is idempotent', async () => {
        assertStringIncludes(await shell(steps['2']), 'modifiedCount: 1')
        const stored = await auths.findOne({ _id: id('stringrole') })
        assertEquals(String(stored.roleId), buyer)
        assertEquals(typeof stored.roleId, 'object', 'now an ObjectId, not text')
        assertStringIncludes(await shell(steps['2']), 'modifiedCount: 0')
      })

      await t.step(
        'step 3 copies roleId into roleIds, keeps an existing roleIds, and is idempotent',
        async () => {
          const first = await shell(steps['3'])
          assertStringIncludes(first, 'modifiedCount: 3') // legacy, half and stringrole; not the null one
          assertEquals((await auths.findOne({ _id: id('legacy') })).roleIds.map(String), [buyer])
          assertEquals(
            (await auths.findOne({ _id: id('half') })).roleIds.map(String),
            [SUPERADMIN_ROLE_ID],
            'an existing roleIds is kept',
          )
          assertEquals('roleId' in (await auths.findOne({ _id: id('legacy') })), false)
          assertEquals((await auths.findOne({ _id: id('nullrole') })).roleId, null, 'never [null]')
          assertEquals('roleIds' in (await auths.findOne({ _id: id('nullrole') })), false)
          assertStringIncludes(await shell(steps['3']), 'modifiedCount: 0')
        },
      )

      await t.step('step 4 removes the roleId that is not an id', async () => {
        await shell(steps['4'])
        assertEquals(await auths.countDocuments({ roleId: { $exists: true } }), 0)
      })

      await t.step(
        'step 5 counts after: no roleId left, every migrated account has roleIds',
        async () => {
          const [stale, migrated] = steps['5'].split('\n').filter((line) => line.startsWith('db.'))
          assertEquals(count(await shell(stale)), 0)
          // first admin (seeded with roleIds), legacy, half, dangling, stringrole.
          assertEquals(count(await shell(migrated)), 5)
        },
      )

      await t.step('after migrating, the account signs in with its permissions', async () => {
        assertEquals((await iam.login('legacy@iam-test.invalid')).claims.aud, ['shop:buy'])
      })

      await t.step(
        'step 6 marks superadmin as a system role: editable before, immutable after',
        async () => {
          // Before: a holder of * can rename it, because nothing says it is a system role.
          const before = await iam.call('PATCH', `/roles/${SUPERADMIN_ROLE_ID}`, {
            token: iam.admin.accessToken,
            body: { description: 'Edited before step 6' },
          })
          assertOk(before)
          await shell(steps['6'])
          assertEquals(
            (await iam.db.col('roles').findOne({ _id: iam.db.oid(SUPERADMIN_ROLE_ID) })).isSystem,
            true,
          )
          assertRefused(
            await iam.call('PATCH', `/roles/${SUPERADMIN_ROLE_ID}`, {
              token: iam.admin.accessToken,
              body: { description: 'Edited after step 6' },
            }),
            403,
            'ROLE_IS_SYSTEM',
          )
          assertRefused(
            await iam.call('DELETE', `/roles/${SUPERADMIN_ROLE_ID}`, {
              token: iam.admin.accessToken,
            }),
            403,
            'ROLE_IS_SYSTEM',
          )
          // The command is written once in the CHANGELOG and repeated verbatim where the system role is explained.
          const command = steps['6'].replace(/\s+/g, ' ').trim()
          assertStringIncludes(AUTHORIZATION.replace(/\s+/g, ' '), command)
          // Running it again changes nothing.
          assertStringIncludes(await shell(steps['6']), 'modifiedCount: 0')
        },
      )

      await t.step(
        'step 7 lists the roles the new validation would reject, and only those',
        async () => {
          const listed = await shell(steps['7'])
          assertStringIncludes(listed, 'Bad Code')
          assert(!listed.includes('fine-code'), listed)
          assert(!listed.includes('superadmin'), listed)
        },
      )

      await t.step('step 8 counts and removes role ids that point at no role', async () => {
        const script = (statements: string[]) =>
          `${steps['8'].split('\n')[0]}\n${statements.join('\n')}`
        const lines = steps['8'].split('\n')
        const countLine = lines.find((line) => line.includes('countDocuments')) as string
        assertEquals(count(await shell(script([countLine]))), 1)
        const updateStart = lines.findIndex((line) => line.includes('updateMany'))
        await shell(script(lines.slice(updateStart)))
        assertEquals(
          (await auths.findOne({ _id: id('dangling') })).roleIds.map(String),
          [buyer],
        )
        assertEquals(count(await shell(script([countLine]))), 0)
      })

      await t.step(
        'the rollback snippet gives each migrated account its first role back as roleId',
        async () => {
          await shell(steps['Rolling back'])
          assertEquals(String((await auths.findOne({ _id: id('legacy') })).roleId), buyer)
          assertEquals(
            String((await auths.findOne({ _id: id('half') })).roleId),
            SUPERADMIN_ROLE_ID,
          )
          assertEquals((await auths.findOne({ _id: id('legacy') })).roleIds.map(String), [buyer])
        },
      )
    } finally {
      await iam.stop()
    }
  },
})
