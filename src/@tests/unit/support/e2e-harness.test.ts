import { assertEquals, assertThrows } from 'jsr:@std/assert@0.224'

import { TEST_DB_PREFIX, validateMongoUri } from '../../support/e2e.ts'

const env = (values: Record<string, string> = {}) =>
  ({ get: (key: string) => values[key] }) as never

Deno.test('validateMongoUri: a plain loopback URI with no database is accepted', () => {
  for (
    const uri of ['mongodb://127.0.0.1:27017', 'mongodb://localhost', 'mongodb://localhost:27017/']
  ) {
    assertEquals(validateMongoUri(uri, env()), uri)
  }
})

Deno.test('validateMongoUri: a URI that names a database is refused, so it can never point at a development one', () => {
  for (
    const uri of ['mongodb://127.0.0.1:27017/zanix_iam', 'mongodb://localhost/presenza_iam_staff']
  ) {
    assertThrows(() => validateMongoUri(uri, env()), Error, 'must not name a database')
  }
})

Deno.test('validateMongoUri: a remote host needs an explicit opt-in', () => {
  assertThrows(() => validateMongoUri('mongodb://db.example.com', env()), Error, 'loopback')
  assertEquals(
    validateMongoUri('mongodb://db.example.com', env({ IAM_TEST_ALLOW_REMOTE_MONGO: 'true' })),
    'mongodb://db.example.com',
  )
})

Deno.test('validateMongoUri: other schemes and garbage are refused', () => {
  assertThrows(
    () => validateMongoUri('mongodb+srv://cluster.example.com', env()),
    Error,
    'plain mongodb://',
  )
  assertThrows(() => validateMongoUri('not a uri', env()), Error, 'not a valid URI')
})

Deno.test('the harness only ever creates and opens databases with the throw-away prefix', async () => {
  assertEquals(TEST_DB_PREFIX, 'znx_iam_test_')
  const { openRawDb } = await import('../../support/e2e.ts')
  for (const name of ['zanix_iam', 'presenza_iam_staff', 'iam_test_abc']) {
    let refusal = ''
    try {
      // deno-lint-ignore no-await-in-loop
      await openRawDb(name)
    } catch (error) {
      refusal = (error as Error).message
    }
    assertEquals(refusal.length > 0, true, name)
  }
})
