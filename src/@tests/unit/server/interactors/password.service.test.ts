import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'
import { ZanixAuthProvider } from '@zanix/auth'
import { NotifierProvider } from '@zanix/notifications'

import { PasswordService } from 'server/interactors/password.interactor.ts'
import { AuthRepository } from 'server/repositories/auth/entity.provider.ts'
import { UsersRepository } from 'server/repositories/users/entity.provider.ts'
import { RolesRepository } from 'server/repositories/roles/entity.provider.ts'
import { ACCESS_TOKEN_EXPIRATION_ENV, REFRESH_TOKEN_EXPIRATION_ENV } from 'utils/constants.ts'
import { fn, mapGetter, mockAccessor } from '../../helpers/mock.ts'

async function withEnv(
  name: string,
  value: string | undefined,
  run: () => Promise<void> | void,
) {
  const original = Deno.env.get(name)
  if (value === undefined) Deno.env.delete(name)
  else Deno.env.set(name, value)
  try {
    await run()
  } finally {
    if (original === undefined) Deno.env.delete(name)
    else Deno.env.set(name, original)
  }
}

const baseAuth = (overrides: Record<string, unknown> = {}) => ({
  id: 'auth-1',
  // A boxed masked-value stub, matching `HydratedAuth.email`'s real shape (`RequiredUnmaskableScalar`,
  // never a plain string) — see `email-key.ts`'s own doc for why `email` is masked at all.
  email: { unmask: () => 'jane@example.com' },
  phone: undefined,
  password: { verify: () => true },
  ...overrides,
})

const defaultAuthRepo = () => ({
  findById: fn((..._args: unknown[]): unknown => baseAuth()),
  findByEmail: fn((..._args: unknown[]): unknown => baseAuth()),
  updateAuth: fn((..._args: unknown[]) => ({})),
})

const defaultAuthProvider = () => ({
  otp: {
    generate: fn((..._args: unknown[]) => '123456'),
    authenticate: fn((..._args: unknown[]) => ({ accessToken: 'access', refreshToken: 'refresh' })),
  },
})

const defaultNotifier = () => ({
  email: fn((..._args: unknown[]) => {}),
  sendMessage: fn((..._args: unknown[]) => {}),
})

const defaultUsersRepo = () => ({
  assertActive: fn((..._args: unknown[]) => {}),
  findById: fn((..._args: unknown[]): unknown => ({ status: 'ACTIVE' })),
})

const defaultRolesRepo = () => ({
  findManyWithPermissions: fn((..._args: unknown[]): unknown => []),
})

function buildService(opts: {
  authRepo?: Partial<ReturnType<typeof defaultAuthRepo>>
  authProvider?: Partial<ReturnType<typeof defaultAuthProvider>>
  notifier?: Partial<ReturnType<typeof defaultNotifier>>
  usersRepo?: Partial<ReturnType<typeof defaultUsersRepo>>
  rolesRepo?: Partial<ReturnType<typeof defaultRolesRepo>>
  session?: Record<string, unknown>
} = {}) {
  const authRepo = { ...defaultAuthRepo(), ...opts.authRepo }
  const authProvider = { ...defaultAuthProvider(), ...opts.authProvider }
  const notifier = { ...defaultNotifier(), ...opts.notifier }
  const usersRepo = { ...defaultUsersRepo(), ...opts.usersRepo }
  const rolesRepo = { ...defaultRolesRepo(), ...opts.rolesRepo }

  const service = new PasswordService('ctx-1')
  mockAccessor(
    service,
    'providers',
    mapGetter([
      [AuthRepository, authRepo],
      [ZanixAuthProvider, authProvider],
      [NotifierProvider, notifier],
      [UsersRepository, usersRepo],
      [RolesRepository, rolesRepo],
    ]),
  )
  mockAccessor(service, 'context', { session: opts.session ?? { subject: 'auth-1' } })

  return { service, authRepo, authProvider, notifier, usersRepo, rolesRepo }
}

Deno.test('changePwd: throws UNAUTHORIZED with no session', async () => {
  const { service } = buildService({ session: {} })
  await assertRejects(
    () => service.changePwd('old', 'New1234'),
    HttpError,
    'Authentication required',
  )
})

Deno.test('changePwd: throws FORBIDDEN when currentPassword does not verify', async () => {
  const { service } = buildService({
    authRepo: { findById: fn(() => baseAuth({ password: { verify: () => false } })) },
  })
  await assertRejects(() => service.changePwd('wrong', 'New1234'), HttpError, 'Invalid password')
})

Deno.test({
  name: 'changePwd: with no app activated (passwordPolicy never registered in the real behavior ' +
    'registry) the permissive fallback lets any new password through — the policy default ' +
    'itself is covered as a pure function in unit/server/apps/auth-app-behaviors.test.ts',
  fn: async () => {
    const { service, authRepo, notifier } = buildService()
    const result = await service.changePwd('old', 'x')
    assertEquals(result, { response: 'password changed' })
    assertEquals(authRepo.updateAuth.calls.length, 1)
    assertEquals(notifier.email.calls.length, 1)
    assertEquals(
      (notifier.email.calls[0]?.[0] as { zanixTemplate: string }).zanixTemplate,
      'password-changed',
    )
  },
})

Deno.test('recovery: an unknown email answers the generic confirmation and sends nothing', async () => {
  const { service, authProvider, notifier } = buildService({
    authRepo: { findByEmail: fn(() => undefined) },
  })
  assertEquals(await service.recovery('nobody@example.com'), { response: 'notification sent' })
  assertEquals(authProvider.otp.generate.calls.length, 0)
  assertEquals(notifier.sendMessage.calls.length, 0)
})

Deno.test('recovery: a deactivated or deleted account answers the generic confirmation and sends nothing', async () => {
  await Promise.all(['INACTIVE', 'DELETED'].map(async (status) => {
    const { service, authProvider, notifier } = buildService({
      usersRepo: { findById: fn(() => ({ status })) },
    })
    assertEquals(await service.recovery('jane@example.com'), { response: 'notification sent' })
    assertEquals(authProvider.otp.generate.calls.length, 0)
    assertEquals(notifier.sendMessage.calls.length, 0)
  }))
})

Deno.test('recovery: an OTP-login request for an unknown email self-registration refuses throws FORBIDDEN', async () => {
  const { service } = buildService({ authRepo: { findByEmail: fn(() => undefined) } })
  await assertRejects(
    () => service.recovery('nobody@example.com', { isLogin: true, notifier: 'sms' }),
    HttpError,
    'No account',
  )
})

Deno.test('recovery: an OTP-login request for a deactivated account still sends the code', async () => {
  const { service, notifier } = buildService({
    usersRepo: { findById: fn(() => ({ status: 'INACTIVE' })) },
  })
  assertEquals(await service.recovery('jane@example.com', { isLogin: true }), {
    response: 'notification sent',
  })
  assertEquals(notifier.sendMessage.calls.length, 1)
})

Deno.test('recovery: an OTP-login request for a deleted account throws FORBIDDEN', async () => {
  const { service, notifier } = buildService({
    usersRepo: { findById: fn(() => ({ status: 'DELETED' })) },
  })
  await assertRejects(
    () => service.recovery('jane@example.com', { isLogin: true }),
    HttpError,
    'no longer exists',
  )
  assertEquals(notifier.sendMessage.calls.length, 0)
})

Deno.test('recovery: no account, isLogin set, self-registration dispatch generates against the email itself and never checks the account active', async () => {
  const { service, authProvider, notifier, usersRepo } = buildService({
    authRepo: { findByEmail: fn(() => undefined) },
  })
  const result = await service.recovery('newcomer@example.com', { isLogin: true })
  assertEquals(result, { response: 'notification sent' })
  assertEquals(authProvider.otp.generate.calls[0]?.[0], {
    target: 'newcomer@example.com',
    exp: 300,
  })
  // No account exists yet — nothing to assert active, and definitely no row written here (account
  // creation itself is `AuthService.loginWithOTPCallback`'s job, only once the code verifies).
  assertEquals(usersRepo.findById.calls.length, 0)
  const message = notifier.sendMessage.calls[0]?.[1] as { zanixTemplate: string; to: string }
  assertEquals(message.zanixTemplate, 'login-otp')
  assertEquals(message.to, 'newcomer@example.com')
})

Deno.test('recovery: no account, isLogin set but notifier is sms — no phone to target, still FORBIDDEN', async () => {
  const { service } = buildService({ authRepo: { findByEmail: fn(() => undefined) } })
  await assertRejects(
    () => service.recovery('newcomer@example.com', { isLogin: true, notifier: 'sms' }),
    HttpError,
    'No account',
  )
})

Deno.test('recovery: dispatches the login-otp email template when isLogin is set', async () => {
  const { service, notifier } = buildService()
  const result = await service.recovery('jane@example.com', { isLogin: true })
  assertEquals(result, { response: 'notification sent' })
  const message = notifier.sendMessage.calls[0]?.[1] as { zanixTemplate: string; to: string }
  assertEquals(message.zanixTemplate, 'login-otp')
  assertEquals(message.to, 'jane@example.com')
})

Deno.test('recovery: dispatches the password-recovery email template without isLogin', async () => {
  const { service, notifier } = buildService()
  await service.recovery('jane@example.com')
  const message = notifier.sendMessage.calls[0]?.[1] as { zanixTemplate: string }
  assertEquals(message.zanixTemplate, 'password-recovery')
})

Deno.test('recovery: throws BAD_REQUEST for sms when the account has no phone on file', async () => {
  const { service } = buildService({
    authRepo: { findByEmail: fn(() => baseAuth({ phone: undefined })) },
  })
  await assertRejects(
    () => service.recovery('jane@example.com', { notifier: 'sms' }),
    HttpError,
    'No sms destination',
  )
})

Deno.test('recovery: dispatches the otp template to the unmasked phone for sms', async () => {
  const phone = { unmask: () => '+15551234567' }
  const { service, notifier } = buildService({
    authRepo: { findByEmail: fn(() => baseAuth({ phone })) },
  })
  await service.recovery('jane@example.com', { notifier: 'sms' })
  const [channel, message] = notifier.sendMessage.calls[0] as [
    string,
    { zanixTemplate: string; to: string },
  ]
  assertEquals(channel, 'sms')
  assertEquals(message.zanixTemplate, 'otp')
  assertEquals(message.to, '+15551234567')
})

Deno.test(
  "recovery: no explicit notifier honors the account's own otpNotifier preference, never both " +
    'channels for the same code',
  async () => {
    const phone = { unmask: () => '+15551234567' }
    const { service, notifier } = buildService({
      authRepo: { findByEmail: fn(() => baseAuth({ phone, otpNotifier: 'whatsapp' })) },
    })
    await service.recovery('jane@example.com', { isLogin: true })
    assertEquals(notifier.sendMessage.calls.length, 1)
    const [channel, message] = notifier.sendMessage.calls[0] as [string, { to: string }]
    assertEquals(channel, 'whatsapp')
    assertEquals(message.to, '+15551234567')
  },
)

Deno.test(
  'recovery: an explicit notifier (a real 2FA challenge) always wins over otpNotifier',
  async () => {
    const phone = { unmask: () => '+15551234567' }
    const { service, notifier } = buildService({
      authRepo: { findByEmail: fn(() => baseAuth({ phone, otpNotifier: 'whatsapp' })) },
    })
    await service.recovery('jane@example.com', { isLogin: true, notifier: 'email' })
    const [channel] = notifier.sendMessage.calls[0] as [string]
    assertEquals(channel, 'email')
  },
)

Deno.test('recoveryCallback: sets the new password and unsets mustChangePassword when given one', async () => {
  const { service, authRepo } = buildService()
  const result = await service.recoveryCallback('jane@example.com', '123456', 'NewPass1') as Record<
    string,
    unknown
  >
  assertEquals(result.accessToken, 'access')
  const [update, options] = authRepo.updateAuth.calls[0] as [
    Record<string, unknown>,
    { unset?: string[] },
  ]
  assertEquals(update.password, 'NewPass1')
  assertEquals(options.unset, ['mustChangePassword'])
})

Deno.test('recoveryCallback: a password the policy rejects throws BAD_REQUEST before the code is consumed', async () => {
  const { service, authProvider, authRepo } = buildService()
  const assertPasswordPolicy = fn((password: unknown) => {
    throw new HttpError('BAD_REQUEST', { message: `rejected ${password}` })
  })
  mockAccessor(service, 'assertPasswordPolicy', assertPasswordPolicy)
  await assertRejects(
    () => service.recoveryCallback('jane@example.com', '123456', 'weak'),
    HttpError,
    'rejected weak',
  )
  assertEquals(assertPasswordPolicy.calls[0], ['weak'])
  assertEquals(authProvider.otp.authenticate.calls.length, 0)
  assertEquals(authRepo.updateAuth.calls.length, 0)
})

Deno.test('recoveryCallback: without a password never applies the password policy', async () => {
  const { service } = buildService()
  const assertPasswordPolicy = fn(() => {})
  mockAccessor(service, 'assertPasswordPolicy', assertPasswordPolicy)
  await service.recoveryCallback('jane@example.com', '123456')
  assertEquals(assertPasswordPolicy.calls.length, 0)
})

Deno.test('recoveryCallback: without a password only consumes the OTP, no password/unset written', async () => {
  const { service, authRepo } = buildService()
  await service.recoveryCallback('jane@example.com', '123456')
  const [update, options] = authRepo.updateAuth.calls[0] as [
    Record<string, unknown>,
    { unset?: string[] },
  ]
  assertEquals('password' in update, false)
  assertEquals(options.unset, undefined)
})

Deno.test('recoveryCallback: no role assigned embeds an empty permissions list', async () => {
  const { service, authProvider, rolesRepo } = buildService()
  await service.recoveryCallback('jane@example.com', '123456')
  assertEquals(
    (authProvider.otp.authenticate.calls[0]?.[2] as { permissions?: string[] }).permissions,
    [],
  )
  assertEquals(rolesRepo.findManyWithPermissions.calls.length, 0)
})

Deno.test('recoveryCallback: with a role assigned, embeds its resolved active permissions', async () => {
  const { service, authProvider } = buildService({
    authRepo: { findByEmail: fn(() => baseAuth({ roleIds: ['role-1'] })) },
    rolesRepo: {
      findManyWithPermissions: fn(() => [{
        id: 'role-1',
        permissions: [{ id: 'p1', code: 'zanix-iam:role-read', isActive: true }],
      }]),
    },
  })
  await service.recoveryCallback('jane@example.com', '123456')
  assertEquals(
    (authProvider.otp.authenticate.calls[0]?.[2] as { permissions?: string[] }).permissions,
    ['zanix-iam:role-read'],
  )
})

Deno.test('recoveryCallback: omits accessExpiration/refreshExpiration when neither env var is configured', async () => {
  await withEnv(ACCESS_TOKEN_EXPIRATION_ENV, undefined, async () => {
    await withEnv(REFRESH_TOKEN_EXPIRATION_ENV, undefined, async () => {
      const { service, authProvider } = buildService()
      await service.recoveryCallback('jane@example.com', '123456')
      const options = authProvider.otp.authenticate.calls[0]?.[2] as Record<string, unknown>
      assertEquals('accessExpiration' in options, false)
      assertEquals('refreshExpiration' in options, false)
    })
  })
})

Deno.test('recoveryCallback: passes accessExpiration when ACCESS_TOKEN_EXPIRATION is configured', async () => {
  await withEnv(ACCESS_TOKEN_EXPIRATION_ENV, '30m', async () => {
    const { service, authProvider } = buildService()
    await service.recoveryCallback('jane@example.com', '123456')
    const options = authProvider.otp.authenticate.calls[0]?.[2] as Record<string, unknown>
    assertEquals(options.accessExpiration, '30m')
    assertEquals('refreshExpiration' in options, false)
  })
})

Deno.test('recoveryCallback: passes refreshExpiration when REFRESH_TOKEN_EXPIRATION is configured', async () => {
  await withEnv(REFRESH_TOKEN_EXPIRATION_ENV, '30d', async () => {
    const { service, authProvider } = buildService()
    await service.recoveryCallback('jane@example.com', '123456')
    const options = authProvider.otp.authenticate.calls[0]?.[2] as Record<string, unknown>
    assertEquals(options.refreshExpiration, '30d')
    assertEquals('accessExpiration' in options, false)
  })
})

Deno.test('addPassword: throws UNAUTHORIZED with no session', async () => {
  const { service } = buildService({ session: {} })
  await assertRejects(() => service.addPassword('New1234'), HttpError, 'Authentication required')
})

Deno.test('addPassword: throws FORBIDDEN when the session subject no longer resolves', async () => {
  const { service } = buildService({ authRepo: { findById: fn(() => undefined) } })
  await assertRejects(() => service.addPassword('New1234'), HttpError, 'Account not found')
})

Deno.test('addPassword: throws CONFLICT when a password is already set — never overwrites', async () => {
  const { service, authRepo } = buildService()
  await assertRejects(
    () => service.addPassword('New1234'),
    HttpError,
    'already set',
  )
  assertEquals(authRepo.updateAuth.calls.length, 0)
})

Deno.test('addPassword: no existing password sets one, no currentPassword ever checked', async () => {
  const { service, authRepo, notifier } = buildService({
    authRepo: { findById: fn(() => baseAuth({ password: undefined })) },
  })
  const result = await service.addPassword('New1234')
  assertEquals(result, { response: 'password added' })
  assertEquals(authRepo.updateAuth.calls[0], [
    { id: 'auth-1', password: 'New1234' },
    { applyProtection: true },
  ])
  assertEquals(
    (notifier.email.calls[0]?.[0] as { zanixTemplate: string }).zanixTemplate,
    'password-changed',
  )
})

Deno.test('removePassword: throws UNAUTHORIZED with no session', async () => {
  const { service } = buildService({ session: {} })
  await assertRejects(() => service.removePassword(), HttpError, 'Authentication required')
})

Deno.test('removePassword: throws FORBIDDEN when the session subject no longer resolves', async () => {
  const { service } = buildService({ authRepo: { findById: fn(() => undefined) } })
  await assertRejects(() => service.removePassword(), HttpError, 'Account not found')
})

Deno.test('removePassword: clears password/mustChangePassword when one is set', async () => {
  const { service, authRepo } = buildService()
  const result = await service.removePassword()
  assertEquals(result, { response: 'password removed' })
  assertEquals(authRepo.updateAuth.calls[0], [
    { id: 'auth-1' },
    { unset: ['password', 'mustChangePassword'] },
  ])
})

Deno.test('removePassword: no password set is a no-op write', async () => {
  const { service, authRepo } = buildService({
    authRepo: { findById: fn(() => baseAuth({ password: undefined })) },
  })
  const result = await service.removePassword()
  assertEquals(result, { response: 'password removed' })
  assertEquals(authRepo.updateAuth.calls.length, 0)
})
