import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { InternalError } from '@zanix/errors'

/**
 * `utils/constants.ts` resolves its rate-limit tiers and `SERVICE_ID` once, at module load, from
 * the environment. Each case sets the environment first and then imports a fresh copy of the
 * module (a unique query string bypasses the module cache), so the load-time branches run against
 * that environment. The default (no override) values are asserted in `constants.test.ts`.
 */

function withEnv<T>(values: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const originals = Object.fromEntries(Object.keys(values).map((key) => [key, Deno.env.get(key)]))
  for (const [key, value] of Object.entries(values)) Deno.env.set(key, value)
  return run().finally(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) Deno.env.delete(key)
      else Deno.env.set(key, value)
    }
  })
}

let importCounter = 0
const freshConstants = () =>
  import(`../../../utils/constants.ts?env-case=${++importCounter}`) as Promise<
    typeof import('utils/constants.ts')
  >

Deno.test('rate-limit tiers: FREE_RATELIMIT/CRITICAL_RATELIMIT/LOGIN_METHODS_RATELIMIT override the defaults', async () => {
  await withEnv(
    { FREE_RATELIMIT: '7', CRITICAL_RATELIMIT: '4', LOGIN_METHODS_RATELIMIT: '5' },
    async () => {
      const constants = await freshConstants()
      assertEquals(constants.freeRateLimit, 7)
      assertEquals(constants.criticalRateLimit, 4)
      assertEquals(constants.loginMethodsRateLimit, 5)
    },
  )
})

Deno.test('rate-limit tiers: a non-numeric override falls back to the default', async () => {
  await withEnv(
    { FREE_RATELIMIT: 'lots', CRITICAL_RATELIMIT: '', LOGIN_METHODS_RATELIMIT: '0' },
    async () => {
      const constants = await freshConstants()
      assertEquals(constants.freeRateLimit, 3)
      assertEquals(constants.criticalRateLimit, 1)
      assertEquals(constants.loginMethodsRateLimit, 2)
    },
  )
})

Deno.test('SERVICE_ID: a configured value is used as the permission-code prefix', async () => {
  await withEnv({ SERVICE_ID: 'acme-iam' }, async () => {
    const constants = await freshConstants()
    assertEquals(constants.SERVICE_ID, 'acme-iam')
    assertEquals(constants.RBAC_PERMISSIONS.roleWrite, 'acme-iam:role-write')
  })
})

Deno.test('SERVICE_ID: a value with characters outside letters/hyphens fails the module load', async () => {
  await withEnv({ SERVICE_ID: 'iam_2' }, async () => {
    await assertRejects(freshConstants, InternalError, 'must contain only letters and hyphens')
  })
})

Deno.test('AUDIT_RETENTION_DAYS sets how long audit events are kept; anything but a positive integer is the default', async () => {
  await withEnv({ AUDIT_RETENTION_DAYS: '90' }, async () => {
    assertEquals((await freshConstants()).auditRetentionDays, 90)
  })
  for (const invalid of ['0', '-5', '1.5', 'abc', '']) {
    // deno-lint-ignore no-await-in-loop
    await withEnv({ AUDIT_RETENTION_DAYS: invalid }, async () => {
      assertEquals((await freshConstants()).auditRetentionDays, 365, `"${invalid}"`)
    })
  }
})

Deno.test('ADMIN_MUTATION_RATELIMIT and its window override the administration limit', async () => {
  await withEnv(
    { ADMIN_MUTATION_RATELIMIT: '5', ADMIN_MUTATION_RATELIMIT_WINDOW_SECONDS: '120' },
    async () => {
      const constants = await freshConstants()
      assertEquals(constants.adminMutationRateLimit, 5)
      assertEquals(constants.adminMutationRateLimitWindowSeconds, 120)
    },
  )
})

Deno.test('ADMIN_MUTATION_RATELIMIT and its window: unset or empty is the default, a positive integer is used', async () => {
  for (
    const unset of [{} as Record<string, string>, {
      ADMIN_MUTATION_RATELIMIT: '',
      ADMIN_MUTATION_RATELIMIT_WINDOW_SECONDS: '',
    } as Record<string, string>]
  ) {
    // deno-lint-ignore no-await-in-loop
    await withEnv(unset, async () => {
      const constants = await freshConstants()
      assertEquals(constants.adminMutationRateLimit, 30)
      assertEquals(constants.adminMutationRateLimitWindowSeconds, 60)
    })
  }
})

Deno.test('ADMIN_MUTATION_RATELIMIT and its window: anything but a positive integer stops the boot with a stable code', async () => {
  for (const name of ['ADMIN_MUTATION_RATELIMIT', 'ADMIN_MUTATION_RATELIMIT_WINDOW_SECONDS']) {
    for (const value of ['-5', '0', '1.5', 'abc', '10x', '1e3', ' 7']) {
      // deno-lint-ignore no-await-in-loop
      await withEnv({ [name]: value }, async () => {
        const error = await assertRejects(() => freshConstants(), InternalError)
        assertEquals((error as InternalError).code, 'IAM_INVALID_POSITIVE_INTEGER_ENV')
        assertEquals(error.message.includes(name), true, `${name}=${value}`)
      })
    }
  }
})
