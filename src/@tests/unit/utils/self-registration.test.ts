import { assertEquals } from 'jsr:@std/assert@0.224'
import { isSelfRegistrationEnabled, SELF_REGISTRATION_ENV } from 'utils/constants.ts'

/** Runs `run` with the env var set to `value` (`undefined` unsets it), then restores it. */
function withEnv<T>(value: string | undefined, run: () => T): T {
  const previous = Deno.env.get(SELF_REGISTRATION_ENV)
  if (value === undefined) Deno.env.delete(SELF_REGISTRATION_ENV)
  else Deno.env.set(SELF_REGISTRATION_ENV, value)
  try {
    return run()
  } finally {
    if (previous === undefined) Deno.env.delete(SELF_REGISTRATION_ENV)
    else Deno.env.set(SELF_REGISTRATION_ENV, previous)
  }
}

Deno.test('isSelfRegistrationEnabled: open unless the instance says exactly "false"', () => {
  assertEquals(withEnv(undefined, isSelfRegistrationEnabled), true)
  assertEquals(withEnv('true', isSelfRegistrationEnabled), true)
  assertEquals(withEnv('', isSelfRegistrationEnabled), true)
  assertEquals(withEnv('FALSE', isSelfRegistrationEnabled), true) // only the literal counts
  assertEquals(withEnv('false', isSelfRegistrationEnabled), false)
})
