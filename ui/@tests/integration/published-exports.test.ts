import { assert, assertEquals, assertStrictEquals } from 'jsr:@std/assert@0.224'

/**
 * Every subpath `deno.json` publishes, loaded through its real module (the React and Preact
 * bindings wire a render factory to a real renderer and real `@zanix/space-ui` components at
 * import time, so loading them is what exercises that wiring). The root `.` entry (`mod.ts`) is
 * excluded: importing it boots the whole service (`Zanix.start`).
 */

const config = JSON.parse(Deno.readTextFileSync('deno.json')) as { exports: Record<string, string> }
const entries = Object.entries(config.exports).filter(([subpath]) => subpath !== '.')

async function load(target: string): Promise<Record<string, unknown>> {
  return await import(`../../../${target.replace(/^\.\//, '')}`)
}

/** Names of an entry's runtime (non-type) exports. */
const runtimeExports = (mod: Record<string, unknown>) => Object.keys(mod).sort()

Deno.test('published exports: every subpath except the root loads and exports at least one runtime value', async () => {
  const empty: string[] = []
  for (const [subpath, target] of entries) {
    // deno-lint-ignore no-await-in-loop
    const mod = await load(target)
    if (runtimeExports(mod).length === 0) empty.push(subpath)
  }
  assertEquals(empty, [])
})

Deno.test('published exports: every React binding has a Preact twin exporting the same names', async () => {
  const mismatches: string[] = []
  for (const [subpath, target] of entries) {
    if (!subpath.endsWith('/preact') || !subpath.startsWith('./ui/')) continue
    const reactTarget = config.exports[subpath.replace(/\/preact$/, '')]
    assert(reactTarget, `${subpath} has no React counterpart`)
    // deno-lint-ignore no-await-in-loop
    const [react, preact] = await Promise.all([load(reactTarget), load(target)])
    const [reactNames, preactNames] = [runtimeExports(react), runtimeExports(preact)]
    if (JSON.stringify(reactNames) !== JSON.stringify(preactNames)) {
      mismatches.push(`${subpath}: react=${reactNames} preact=${preactNames}`)
    }
    for (const name of preactNames) {
      const value = preact[name]
      if (typeof value !== 'function' && typeof value !== 'object') {
        mismatches.push(`${subpath}: ${name} is a ${typeof value}`)
      }
    }
  }
  assertEquals(mismatches, [])
})

Deno.test('published exports: every ui/components and ui/pages React binding has a Preact twin', () => {
  const missing = entries
    .map(([subpath]) => subpath)
    .filter((subpath) => /^\.\/ui\/(components|pages)\/[^/]+$/.test(subpath))
    .filter((subpath) => !config.exports[`${subpath}/preact`])
  assertEquals(missing, [])
})

Deno.test('published exports: the ui/sdk client entrypoints re-export the real client/RTO/validation modules', async () => {
  const [login, otp, totp, phone, users, recovery, validation] = await Promise.all([
    import('../../sdk/login.ts'),
    import('../../sdk/otp.ts'),
    import('../../sdk/totp.ts'),
    import('../../sdk/phone.ts'),
    import('../../sdk/users.ts'),
    import('../../sdk/password-recovery.ts'),
    import('../../sdk/validation.ts'),
  ])
  const base = await import('../../sdk/client/base.ts')
  const loginRtos = await import('../../sdk/rtos/login.ts')
  const common = await import('../../sdk/rtos/common.ts')

  assertStrictEquals(
    login.LoginClient,
    (await import('../../sdk/client/login.client.ts')).LoginClient,
  )
  assertStrictEquals(login.IamApiClient, base.IamApiClient)
  assertStrictEquals(login.LoginRTO, loginRtos.LoginRTO)
  assertStrictEquals(login.OAUTH_PROVIDERS, common.OAUTH_PROVIDERS)
  assertStrictEquals(otp.OtpClient, (await import('../../sdk/client/otp.client.ts')).OtpClient)
  assertStrictEquals(otp.OtpLoginRTO, loginRtos.OtpLoginRTO)
  assertStrictEquals(totp.TotpClient, (await import('../../sdk/client/totp.client.ts')).TotpClient)
  assertStrictEquals(
    phone.PhoneClient,
    (await import('../../sdk/client/phone.client.ts')).PhoneClient,
  )
  assertStrictEquals(
    users.UsersClient,
    (await import('../../sdk/client/users.client.ts')).UsersClient,
  )
  assertStrictEquals(
    recovery.PasswordClient,
    (await import('../../sdk/client/password.client.ts')).PasswordClient,
  )
  assertStrictEquals(
    validation.validateEmail,
    (await import('../../sdk/validation/email.ts')).validateEmail,
  )
  assertStrictEquals(
    validation.validatePassword,
    (await import('../../sdk/validation/password.ts')).validatePassword,
  )
  assertStrictEquals(
    validation.validateVerificationCode,
    (await import('../../sdk/validation/code.ts')).validateVerificationCode,
  )
})
