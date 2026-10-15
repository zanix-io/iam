// deno-lint-ignore-file no-await-in-loop
import { assertEquals } from 'jsr:@std/assert@0.224'
import { ZanixMongoConnector } from '@zanix/datamaster'

import 'server/repositories/auth/model.defs.ts'
import { mongoUri, TEST_DB_PREFIX } from '../../../support/e2e.ts'
import { AuthRepository } from 'server/repositories/auth/entity.provider.ts'

/**
 * `AuthRepository.updateAuth`'s `onlyIf` against a REAL MongoDB: the update applies only while the
 * stored document still meets the condition, and of any number of concurrent updates with the same
 * condition exactly one matches. This is what makes a TOTP reset happen once. Skipped unless
 * `IAM_TEST_MONGO_URI` points at a MongoDB the test may write to; it uses a throw-away database.
 */
const uri = mongoUri
const ONLY_IF_TOTP = {
  $or: [{ 'twoFactorAuthConfig.method': 'totp' }, { totpSecret: { $exists: true } }],
}

Deno.test({
  name:
    'mongo: updateAuth onlyIf applies once while the condition holds, and matches nothing after',
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
      Object.defineProperty(AuthRepository.prototype, 'database', {
        get: () => connector,
        configurable: true,
      })
      const auth = new AuthRepository()
      delete (AuthRepository.prototype as unknown as { database?: unknown }).database

      const created = await auth.registerAuth({ email: 'once@example.com' })
      const id = String(created.id)
      const unset = ['twoFactorAuthConfig'] as const

      // Nothing to remove: no match, nothing written.
      const none = await auth.updateAuth({ id }, { unset: [...unset], onlyIf: ONLY_IF_TOTP })
      assertEquals(none.matchedCount, 0)

      for (let round = 0; round < 5; round++) {
        await auth.updateAuth({
          id,
          twoFactorAuthConfig: { method: 'totp', triggerOn: ['login'] },
        })
        const results = await Promise.all(
          Array.from(
            { length: 6 },
            () => auth.updateAuth({ id }, { unset: [...unset], onlyIf: ONLY_IF_TOTP }),
          ),
        )
        assertEquals(results.filter((result) => result.matchedCount === 1).length, 1)
      }
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
