import { assertEquals, assertStrictEquals } from 'jsr:@std/assert@0.224'

import authApp from 'server/apps/auth.app.ts'
import { resolveEffectivePermissions as rbacResolveEffectivePermissions } from 'utils/rbac.ts'

/**
 * Pure-function coverage for `auth.app.ts`'s `behaviors.*.default` implementations — each is a
 * plain function with no interaction with anything else, correctly `unit/`-tier per
 * `zanix-test-tier-conventions`. The real, WIRED path (`resolveBehavior('auth', name)` after a
 * host activates this app, or a host's own override) is covered in
 * `integration/server/apps/auth-app.test.ts` and, via `PasswordService.changePwd`'s own call
 * site, `unit/server/interactors/password.service.test.ts`.
 */

const passwordPolicy = authApp.definition.behaviors.passwordPolicy.default as (
  password: string,
) => true | string
const totpProvisioningLabel = authApp.definition.behaviors.totpProvisioningLabel.default as (
  email: string,
) => string
const resolveEffectivePermissions = authApp.definition.behaviors.resolveEffectivePermissions
  .default as (role: unknown) => string[]

Deno.test('passwordPolicy: rejects a password shorter than 8 characters', () => {
  assertEquals(passwordPolicy('Ab1'), 'Password must be at least 8 characters long.')
})

Deno.test('passwordPolicy: rejects a password with no uppercase letter', () => {
  assertEquals(passwordPolicy('lowercase1'), 'Password must contain an uppercase letter.')
})

Deno.test('passwordPolicy: rejects a password with no digit', () => {
  assertEquals(passwordPolicy('NoDigitsHere'), 'Password must contain a digit.')
})

Deno.test('passwordPolicy: accepts a password meeting every rule', () => {
  assertEquals(passwordPolicy('GoodPass1'), true)
})

Deno.test('totpProvisioningLabel: defaults to the raw email, unchanged', () => {
  assertEquals(totpProvisioningLabel('jane@example.com'), 'jane@example.com')
})

Deno.test('resolveEffectivePermissions: registered as the real utils/rbac.ts implementation, not a copy', () => {
  // A real identity check (`===`), not just behavioral equivalence — see `utils/rbac.ts`'s own
  // doc for why `auth.app.ts` reuses this function directly rather than reimplementing it inline
  // (the same implementation also backs `AuthService`/`PasswordService`'s own unactivated-app
  // fallback — see those files' own `resolveSessionPermissions`).
  assertStrictEquals(resolveEffectivePermissions, rbacResolveEffectivePermissions)
})
