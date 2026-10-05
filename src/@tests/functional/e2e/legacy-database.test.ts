import { assert, assertEquals } from 'jsr:@std/assert@0.224'

import {
  e2eIgnore,
  openRawDb,
  type RawDb,
  startIam,
  SUPERADMIN_ROLE_ID,
} from '../../support/e2e.ts'

/**
 * A database that a 1.x server already seeded (permissions without `audit-read`, a `superadmin`
 * without `isSystem`, the 1.x seeder versions registered in `zanix-seeders`) is started by the 2.x
 * server. Seeders run once per name and version, so the new data only arrives through seeders with
 * new versions: this proves it does, once, and that a second start changes nothing.
 */
const AUDIT_READ_ID = '693000000000000000000110'
const NEW_SEEDERS = ['permissions:seedMissingPermissions', 'roles:markSuperadminAsSystem']

/** Starts 2.x, stops it keeping the database, and turns what it left into what 1.x would have. */
async function make1xDatabase(): Promise<string> {
  const first = await startIam()
  const dbName = first.dbName
  await first.stop({ keepDatabase: true })
  const raw = await openRawDb(dbName)
  try {
    await raw.col('permissions').deleteOne({ _id: raw.oid(AUDIT_READ_ID) })
    await raw.col('roles').updateOne({ _id: raw.oid(SUPERADMIN_ROLE_ID) }, {
      $unset: { isSystem: '' },
    })
    // What 1.x had registered: the permissions seeder at 1.1.0 and the roles one at 1.0.0 only.
    await raw.col('zanix-seeders').deleteMany({ name: { $in: NEW_SEEDERS } })
    await raw.col('zanix-seeders').insertOne({
      name: 'permissions:seedManyByIdIfMissing',
      version: '1.1.0',
      status: 'success',
      duration: 1,
      createdAt: new Date(),
    })
  } finally {
    await raw.close()
  }
  return dbName
}

async function inspect(dbName: string, run: (raw: RawDb) => Promise<void>) {
  const raw = await openRawDb(dbName)
  try {
    await run(raw)
  } finally {
    await raw.close()
  }
}

Deno.test({
  name: 'e2e: starting 2.x on a 1.x database seeds audit-read and marks superadmin, once',
  ignore: e2eIgnore,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dbName = await make1xDatabase()
    let permissionsAfterFirst = 0
    let superadminAfterFirst: Record<string, unknown> = {}
    try {
      await inspect(dbName, async (raw) => {
        assertEquals(await raw.col('permissions').countDocuments({ code: /:audit-read$/ }), 0)
        assertEquals((await raw.col('roles').findOne({ code: 'superadmin' })).isSystem, undefined)
      })

      // First start of 2.x on it.
      const second = await startIam({ dbName })
      await second.stop({ keepDatabase: true })
      await inspect(dbName, async (raw) => {
        const audit = await raw.col('permissions').find({ code: /:audit-read$/ }).toArray()
        assertEquals(audit.length, 1)
        assertEquals(String(audit[0]._id), AUDIT_READ_ID)
        permissionsAfterFirst = await raw.col('permissions').countDocuments({})
        const superadmin = await raw.col('roles').find({ code: 'superadmin' }).toArray()
        assertEquals(superadmin.length, 1)
        assertEquals(superadmin[0].isSystem, true)
        superadminAfterFirst = superadmin[0]
        const records = await raw.col('zanix-seeders').find({ name: { $in: NEW_SEEDERS } })
          .toArray()
        assertEquals(records.map((r: { name: string }) => r.name).sort(), [...NEW_SEEDERS].sort())
      })

      // A second start changes nothing.
      const third = await startIam({ dbName })
      try {
        const roles = await third.call('GET', `/roles/${SUPERADMIN_ROLE_ID}`, {
          token: third.admin.accessToken,
        })
        assertEquals(roles.status, 200)
      } finally {
        await third.stop({ keepDatabase: true })
      }
      await inspect(dbName, async (raw) => {
        assertEquals(await raw.col('permissions').countDocuments({}), permissionsAfterFirst)
        assertEquals(await raw.col('permissions').countDocuments({ code: /:audit-read$/ }), 1)
        const superadmin = await raw.col('roles').find({ code: 'superadmin' }).toArray()
        assertEquals(superadmin.length, 1)
        assertEquals(superadmin[0], superadminAfterFirst, 'superadmin is untouched, updatedAt too')
        assertEquals(
          await raw.col('zanix-seeders').countDocuments({ name: { $in: NEW_SEEDERS } }),
          NEW_SEEDERS.length,
        )
      })
    } finally {
      await dropDatabase(dbName)
    }
  },
})

Deno.test({
  name: 'e2e: an audit-read created by hand under another id is kept, the seeded one skipped',
  ignore: e2eIgnore,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dbName = await make1xDatabase()
    const handId = '6a00000000000000000000aa'
    try {
      let code = ''
      await inspect(dbName, async (raw) => {
        code = (await raw.col('permissions').findOne({ code: /:audit-read$/ }))?.code ??
          (await raw.col('permissions').findOne({ code: /:role-read$/ })).code.replace(
            'role-read',
            'audit-read',
          )
        await raw.col('permissions').insertOne({
          _id: raw.oid(handId),
          code,
          name: 'Hand made audit-read',
          description: 'Created by hand',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      })
      const started = await startIam({ dbName })
      await started.stop({ keepDatabase: true })
      await inspect(dbName, async (raw) => {
        const found = await raw.col('permissions').find({ code }).toArray()
        assertEquals(found.length, 1, 'the unique code is respected: no duplicate')
        assertEquals(String(found[0]._id), handId)
        assertEquals((await raw.col('roles').findOne({ code: 'superadmin' })).isSystem, true)
        assert(await raw.col('permissions').findOne({ code: /:role-read$/ }))
      })
    } finally {
      await dropDatabase(dbName)
    }
  },
})

/** Drops a database the test kept (a failed assertion must not leave it behind). */
async function dropDatabase(dbName: string) {
  const raw = await openRawDb(dbName)
  try {
    await raw.drop()
  } finally {
    await raw.close()
  }
}
