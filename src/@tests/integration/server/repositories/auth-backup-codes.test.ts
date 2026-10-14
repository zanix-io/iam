import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@0.224'
import { ZanixMongoConnector } from '@zanix/datamaster'

import 'server/repositories/auth/model.defs.ts'
import { mongoUri, TEST_DB_PREFIX } from '../../../support/e2e.ts'
import { AuthRepository } from 'server/repositories/auth/entity.provider.ts'
import { generateBackupCodes, hashBackupCodes, normalizeBackupCode } from 'utils/backup-codes.ts'
import { hashBackupCode } from 'utils/backup-codes.ts'

/**
 * The backup-code primitives against a REAL MongoDB: that a use is one atomic write (of N concurrent
 * uses of one code exactly one finds it), that the digests are never loaded unless asked for, and
 * that replacing and clearing the set behave as the rules assume. A mock cannot prove these: they are
 * MongoDB semantics. Skipped unless `IAM_TEST_MONGO_URI` points at a MongoDB the test may write to; it
 * uses a throw-away database of its own and drops it.
 *
 *   IAM_TEST_MONGO_URI=mongodb://localhost:27017 deno test -A \
 *     src/@tests/integration/server/repositories/auth-backup-codes.test.ts
 */
const uri = mongoUri

/** A repository bound to `connector`, the way the DI container would build it. */
function bound(connector: ZanixMongoConnector) {
  Object.defineProperty(AuthRepository.prototype, 'database', {
    get: () => connector,
    configurable: true,
  })
  try {
    return new AuthRepository()
  } finally {
    delete (AuthRepository.prototype as unknown as { database?: unknown }).database
  }
}

Deno.test({
  name:
    'mongo: a backup code is spent by one atomic write, and its digests are never loaded by default',
  ignore: !uri,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const previous = {
      seeders: Deno.env.get('DATABASE_SEEDERS'),
      key: Deno.env.get('DATA_SECRET_KEY'),
    }
    Deno.env.set('DATABASE_SEEDERS', 'false')
    Deno.env.set('DATA_SECRET_KEY', 'iam-integration-test-key-not-a-secret')
    const dbName = `${TEST_DB_PREFIX}${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
    const connector = new ZanixMongoConnector({
      uri,
      seedModel: false,
      triggersModel: false,
      config: { dbName },
    })
    await connector.isReady
    try {
      const auth = bound(connector)
      const created = await auth.registerAuth({ email: 'codes@example.com' })
      const id = String(created.id)

      // No codes yet.
      assertEquals(await auth.countBackupCodes(id), 0)
      assertEquals(await auth.consumeBackupCode(id, 'anything'), undefined)

      // Replace, count.
      const codes = generateBackupCodes()
      const hashes = await hashBackupCodes(id, codes)
      await auth.replaceBackupCodes(id, hashes)
      assertEquals(await auth.countBackupCodes(id), 10)

      // The digests are not part of an ordinary read, nor of its JSON.
      const plain = await auth.findById(id)
      assertEquals(
        (plain as unknown as { backupCodeHashes?: string[] }).backupCodeHashes,
        undefined,
      )
      const json = JSON.stringify(plain?.toJSON())
      for (const hash of hashes) assertFalse(json.includes(hash))
      assertEquals(
        (plain as unknown as { backupCodesGeneratedAt?: Date }).backupCodesGeneratedAt instanceof
          Date,
        true,
      )

      // A use: found once, remaining counts down, the second use of the same code finds nothing.
      const digest = (code: string) => hashBackupCode(id, normalizeBackupCode(code) as string)
      assertEquals(await auth.consumeBackupCode(id, await digest(codes[0])), 9)
      assertEquals(await auth.consumeBackupCode(id, await digest(codes[0])), undefined)
      assertEquals(await auth.countBackupCodes(id), 9)
      // Another account's id does not spend this account's code.
      assertEquals(await auth.consumeBackupCode('693000000000000000000b01', hashes[1]), undefined)

      // Of 25 concurrent uses of one code, exactly one wins.
      const target = await digest(codes[1])
      const outcomes = await Promise.all(
        Array.from({ length: 25 }, () => auth.consumeBackupCode(id, target)),
      )
      assertEquals(outcomes.filter((remaining) => remaining !== undefined).length, 1)
      assertEquals(await auth.countBackupCodes(id), 8)

      // The set written through the generic update (as the TOTP confirmation does) reads back.
      const fresh = generateBackupCodes()
      await auth.updateAuth({
        id,
        backupCodeHashes: await hashBackupCodes(id, fresh),
        backupCodesGeneratedAt: new Date(),
      }, { applyProtection: true })
      assertEquals(await auth.countBackupCodes(id), 10)
      // A replacement drops every earlier code at once.
      assertEquals(await auth.consumeBackupCode(id, await digest(codes[2])), undefined)
      assertEquals(await auth.consumeBackupCode(id, await digest(fresh[0])), 9)

      // Clearing (disable and operator reset) removes the set and its timestamp.
      await auth.clearBackupCodes(id)
      assertEquals(await auth.countBackupCodes(id), 0)
      assertEquals(await auth.consumeBackupCode(id, await digest(fresh[1])), undefined)
      await auth.replaceBackupCodes(id, hashes)
      await auth.updateAuth({ id }, { unset: ['backupCodeHashes', 'backupCodesGeneratedAt'] })
      assertEquals(await auth.countBackupCodes(id), 0)
      assert(
        !((await auth.findById(id)) as unknown as { backupCodesGeneratedAt?: Date })
          .backupCodesGeneratedAt,
      )
    } finally {
      await connector.getModel('auth').db.dropDatabase()
      await (connector as unknown as { close: () => Promise<void> }).close()
      for (
        const [name, value] of [['DATABASE_SEEDERS', previous.seeders], [
          'DATA_SECRET_KEY',
          previous.key,
        ]] as const
      ) {
        if (value === undefined) Deno.env.delete(name)
        else Deno.env.set(name, value)
      }
    }
  },
})
