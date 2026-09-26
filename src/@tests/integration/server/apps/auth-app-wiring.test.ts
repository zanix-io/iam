import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'
import { ZanixAuthProvider } from '@zanix/auth'
import { NotifierProvider } from '@zanix/notifications'
import { registerApp, resolveConfig } from '@zanix/app/runtime'

import authApp from 'server/apps/auth.app.ts'
import { AuthService } from 'server/interactors/auth.interactor.ts'
import { PasswordService } from 'server/interactors/password.interactor.ts'
import { AuthRepository } from 'server/repositories/auth/entity.provider.ts'
import { UsersRepository } from 'server/repositories/users/entity.provider.ts'
import { fn, mapGetter, mockAccessor } from '../../../unit/helpers/mock.ts'

/**
 * `auth.app.ts`'s behaviors and config defaults, registered through `@zanix/app`'s real
 * `registerApp`, reaching the interactors that resolve them (`resolveBehavior`/`resolveConfig`).
 * The unit-tier interactor tests run with no app registered, so they only see the "nothing
 * registered" fallbacks; this file covers the wired path. `setup` is left out of the registered
 * definition: it seeds a template through `TemplatesAdminRepository` and is covered separately in
 * `unit/server/apps/auth-app-setup.test.ts`. Repositories and `@zanix/auth` providers are still
 * recorders: the interaction under test is manifest -> runtime registry -> interactor.
 */

await registerApp({ ...authApp.definition, setup: undefined } as never, new Map())

function passwordService(auth: Record<string, unknown>) {
  const updateAuth = fn((..._args: unknown[]) => ({}))
  const service = new PasswordService('ctx-1')
  mockAccessor(
    service,
    'providers',
    mapGetter([
      [AuthRepository, { findById: () => auth, updateAuth }],
      [UsersRepository, { assertActive: () => {} }],
      [NotifierProvider, { email: () => {} }],
      [ZanixAuthProvider, { session: { revokeAllTokens: () => {} } }],
    ]),
  )
  mockAccessor(service, 'context', { session: { subject: 'auth-1' }, cookies: {} })
  return { service, updateAuth }
}

Deno.test('auth app wiring: config defaults are registered (totpToleranceSteps 1, self-registration on)', () => {
  assertEquals(resolveConfig('auth', 'totpToleranceSteps'), 1)
  assertEquals(resolveConfig('auth', 'selfRegistrationViaOAuth'), true)
  assertEquals(resolveConfig('auth', 'selfRegistrationViaOTP'), true)
})

Deno.test('auth app wiring: changePwd rejects a new password the registered passwordPolicy refuses', async () => {
  const { service, updateAuth } = passwordService({
    id: 'auth-1',
    userId: 'user-1',
    password: { verify: () => true },
  })
  await assertRejects(
    () => service.changePwd('OldPass1', 'short'),
    HttpError,
    'Password must be at least 8 characters long.',
  )
  assertEquals(updateAuth.calls, [])
})

Deno.test('auth app wiring: addPassword rejects a first password the registered passwordPolicy refuses', async () => {
  const { service, updateAuth } = passwordService({ id: 'auth-1', userId: 'user-1' })
  await assertRejects(
    () => service.addPassword('alllowercase1'),
    HttpError,
    'Password must contain an uppercase letter.',
  )
  assertEquals(updateAuth.calls, [])
})

Deno.test('auth app wiring: totpEnroll labels the provisioning URI through the registered totpProvisioningLabel', async () => {
  const getProvisioningUri = fn((..._args: unknown[]) => 'otpauth://totp/x')
  const service = new AuthService('ctx-1')
  mockAccessor(
    service,
    'providers',
    mapGetter([
      [AuthRepository, { findById: () => ({ email: { unmask: () => 'jane@example.com' } }) }],
      [ZanixAuthProvider, { totp: { generateSecret: () => 'SECRET', getProvisioningUri } }],
    ]),
  )
  mockAccessor(service, 'context', { session: { subject: 'auth-1' }, cookies: {} })

  assertEquals(await service.totpEnroll(), { secret: 'SECRET', uri: 'otpauth://totp/x' })
  assertEquals(getProvisioningUri.calls[0][0], 'SECRET')
  assertEquals(getProvisioningUri.calls[0][1], 'jane@example.com')
})
