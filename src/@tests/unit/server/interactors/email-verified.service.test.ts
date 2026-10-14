// deno-lint-ignore-file no-await-in-loop
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'
import { generateOTP, verifyOTP, ZanixAuthProvider } from '@zanix/auth'
import { NotifierProvider } from '@zanix/notifications'

import { AuthService } from 'server/interactors/auth.interactor.ts'
import { PasswordService } from 'server/interactors/password.interactor.ts'
import { stepUpOtpTarget, StepUpService } from 'server/interactors/step-up.interactor.ts'
import { otpLoginTarget } from 'server/interactors/email-proof.ts'
import { AuthRepository } from 'server/repositories/auth/entity.provider.ts'
import { UsersRepository } from 'server/repositories/users/entity.provider.ts'
import { RolesRepository } from 'server/repositories/roles/entity.provider.ts'
import { fn, mapGetter, mockAccessor } from '../../helpers/mock.ts'
import { claimProviderEntry } from '../../helpers/factor-change.ts'

/** An in-memory stand-in for the `cache` provider's local store, so the real `generateOTP` and
 * `verifyOTP` (single use, attempt cap) run against it. */
function fakeOtpCache() {
  const store = new Map<string, unknown>()
  return {
    local: {
      get: (key: string) => store.get(key),
      set: (key: string, value: unknown) => void store.set(key, value),
      delete: (key: string) => void store.delete(key),
    },
  }
}

const baseAuth = (overrides: Record<string, unknown> = {}) => ({
  id: 'auth-1',
  userId: 'user-1',
  email: { unmask: () => 'jane@example.com' },
  password: { verify: () => true },
  twoFactorAuthConfig: undefined,
  totpSecret: undefined,
  ...overrides,
})

type Options = {
  auth?: Record<string, unknown> | undefined
  markEmailVerified?: (...args: unknown[]) => unknown
  verifiedEmail?: Record<string, unknown>
}

function build<T extends AuthService | PasswordService | StepUpService>(
  Service: new (id: string) => T,
  opts: Options = {},
) {
  const cache = fakeOtpCache()
  const auth = 'auth' in opts ? opts.auth : baseAuth()
  const authRepo = {
    findByEmail: fn((..._args: unknown[]): unknown => auth),
    findById: fn((..._args: unknown[]): unknown => auth),
    registerAuth: fn((..._args: unknown[]) => ({})),
    updateAuth: fn((..._args: unknown[]) => ({})),
    markEmailVerified: fn(opts.markEmailVerified ?? ((..._args: unknown[]) => true)),
  }
  const authProvider = {
    session: {
      generateTokens: fn((..._args: unknown[]) => ({ accessToken: 'access', refreshToken: 'r' })),
      refreshTokens: fn((..._args: unknown[]) => ({
        oldToken: 'old',
        payload: {},
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      })),
    },
    totp: {
      authenticate: fn((..._args: unknown[]) => ({ accessToken: 'access', refreshToken: 'r' })),
    },
    otp: {
      generate: fn((options: { target: string; exp?: number }) =>
        generateOTP(cache as never, options)
      ),
      verify: fn((target: string, code: string) => verifyOTP(cache as never, target, code)),
      authenticate: fn(
        async (target: string, code: string, _options: Record<string, unknown>) => {
          if (!(await verifyOTP(cache as never, target, code))) {
            throw new HttpError('FORBIDDEN', { code: 'INVALID_OTP' })
          }
          return { accessToken: 'access', refreshToken: 'r' }
        },
      ),
    },
  }
  const usersRepo = {
    assertActive: fn((..._args: unknown[]) => {}),
    findById: fn((..._args: unknown[]): unknown => ({ status: 'ACTIVE' })),
    registerUser: fn((..._args: unknown[]): unknown => ({ id: 'user-1' })),
  }
  const notifier = { email: fn((..._args: unknown[]) => {}), sendMessage: fn(() => {}) }
  const rolesRepo = { findManyWithPermissions: fn((..._args: unknown[]): unknown => []) }

  const service = new Service('ctx-1')
  mockAccessor(
    service,
    'providers',
    mapGetter([
      [AuthRepository, authRepo],
      [ZanixAuthProvider, authProvider],
      [NotifierProvider, notifier],
      [UsersRepository, usersRepo],
      [RolesRepository, rolesRepo],
      claimProviderEntry(),
    ]),
  )
  mockAccessor(service, 'context', { session: { subject: 'auth-1' }, cookies: {} })
  return { service, cache, authRepo, authProvider, usersRepo }
}

/** The `email_verified` claim a mocked session call was asked to carry. */
const claimOf = (call: unknown[] | undefined, index = 0) =>
  ((call?.[index] as { payload?: Record<string, unknown> })?.payload ?? {}).email_verified

const otpOptionsOf = (authProvider: ReturnType<typeof build>['authProvider']) =>
  authProvider.otp.authenticate.calls.at(-1)?.[2]

// --- email one-time code sign-in -------------------------------------------------------------

Deno.test('loginWithOTPCallback: a verified email code records the proof and carries email_verified', async () => {
  const { service, cache, authRepo, authProvider } = build(AuthService)
  await generateOTP(cache as never, { target: otpLoginTarget('auth-1', 'email') })
  const code = cache.local.get('zanix:otp:auth-1') as string

  const result = await service.loginWithOTPCallback('jane@example.com', code) as Record<
    string,
    unknown
  >

  assertEquals(result.accessToken, 'access')
  assertEquals(authRepo.markEmailVerified.calls.length, 1)
  assertEquals(authRepo.markEmailVerified.calls[0]?.[0], 'auth-1')
  assertEquals(claimOf([otpOptionsOf(authProvider)]), true)
})

Deno.test('loginWithOTPCallback: a code delivered by SMS or WhatsApp proves a phone, not the mailbox', async () => {
  for (const channel of ['sms', 'whatsapp'] as const) {
    const { service, cache, authRepo, authProvider } = build(AuthService)
    await generateOTP(cache as never, { target: otpLoginTarget('auth-1', channel) })
    const code = cache.local.get(`zanix:otp:auth-1:${channel}`) as string

    await service.loginWithOTPCallback('jane@example.com', code)

    assertEquals(authRepo.markEmailVerified.calls.length, 0, channel)
    assertEquals(claimOf([otpOptionsOf(authProvider)]), false, channel)
  }
})

Deno.test('loginWithOTPCallback: an SMS code keeps the claim true for an account already verified', async () => {
  const { service, cache, authProvider } = build(AuthService, {
    auth: baseAuth({ emailVerifiedAt: new Date('2026-01-01T00:00:00Z') }),
  })
  await generateOTP(cache as never, { target: otpLoginTarget('auth-1', 'sms') })
  const code = cache.local.get('zanix:otp:auth-1:sms') as string

  await service.loginWithOTPCallback('jane@example.com', code)

  assertEquals(claimOf([otpOptionsOf(authProvider)]), true)
})

Deno.test('loginWithOTPCallback: a wrong code is FORBIDDEN and records nothing', async () => {
  const { service, cache, authRepo } = build(AuthService)
  await generateOTP(cache as never, { target: otpLoginTarget('auth-1', 'email') })

  const error = await assertRejects(
    () => service.loginWithOTPCallback('jane@example.com', 'nope00'),
    HttpError,
  )
  assertEquals(error.code, 'INVALID_OTP')
  assertEquals(authRepo.markEmailVerified.calls.length, 0)
})

Deno.test('loginWithOTPCallback: a failing write does not fail the sign-in', async () => {
  const { service, cache, authRepo } = build(AuthService, {
    markEmailVerified: () => {
      throw new Error('database unavailable')
    },
  })
  await generateOTP(cache as never, { target: otpLoginTarget('auth-1', 'email') })
  const code = cache.local.get('zanix:otp:auth-1') as string

  const result = await service.loginWithOTPCallback('jane@example.com', code) as Record<
    string,
    unknown
  >

  assertEquals(result.accessToken, 'access')
  assertEquals(authRepo.markEmailVerified.calls.length, 1)
})

Deno.test('loginWithOTPCallback: a second sign-in repeats the idempotent write and still succeeds', async () => {
  const { service, cache, authRepo } = build(AuthService, {
    auth: baseAuth({ emailVerifiedAt: new Date('2026-01-01T00:00:00Z') }),
    markEmailVerified: () => false,
  })
  await generateOTP(cache as never, { target: otpLoginTarget('auth-1', 'email') })
  const code = cache.local.get('zanix:otp:auth-1') as string

  const result = await service.loginWithOTPCallback('jane@example.com', code) as Record<
    string,
    unknown
  >

  assertEquals(result.accessToken, 'access')
  assertEquals(authRepo.markEmailVerified.calls.length, 1)
})

Deno.test('loginWithOTPCallback: a self-registered account is created already verified', async () => {
  let lookups = 0
  const { service, cache, authRepo, authProvider } = build(AuthService)
  authRepo.findByEmail = fn((..._args: unknown[]): unknown =>
    lookups++ === 0 ? undefined : baseAuth({ emailVerifiedAt: new Date() })
  )
  await generateOTP(cache as never, { target: 'new@example.com' })
  const code = cache.local.get('zanix:otp:new@example.com') as string

  // `build` fixed the repository object at construction; re-point the shadowed getter at it.
  mockAccessor(
    service,
    'providers',
    mapGetter([
      [AuthRepository, authRepo],
      [ZanixAuthProvider, authProvider],
      [NotifierProvider, { email: fn(() => {}) }],
      [UsersRepository, {
        registerUser: fn(() => ({ id: 'user-1' })),
        assertActive: fn(() => {}),
      }],
      [RolesRepository, { findManyWithPermissions: fn(() => []) }],
      claimProviderEntry(),
    ]),
  )

  await service.loginWithOTPCallback('new@example.com', code)

  const registered = authRepo.registerAuth.calls[0]?.[0] as Record<string, unknown>
  assert(registered.emailVerifiedAt instanceof Date)
  assertEquals(claimOf(authProvider.session.generateTokens.calls[0]), true)
})

// --- password recovery code ------------------------------------------------------------------

Deno.test('recoveryCallback: an email code records the proof, an SMS code does not', async () => {
  const email = build(PasswordService)
  await generateOTP(email.cache as never, { target: otpLoginTarget('auth-1', 'email') })
  await email.service.recoveryCallback(
    'jane@example.com',
    email.cache.local.get('zanix:otp:auth-1') as string,
  )
  assertEquals(email.authRepo.markEmailVerified.calls.length, 1)
  assertEquals(claimOf([otpOptionsOf(email.authProvider)]), true)

  const sms = build(PasswordService)
  await generateOTP(sms.cache as never, { target: otpLoginTarget('auth-1', 'sms') })
  await sms.service.recoveryCallback(
    'jane@example.com',
    sms.cache.local.get('zanix:otp:auth-1:sms') as string,
  )
  assertEquals(sms.authRepo.markEmailVerified.calls.length, 0)
  assertEquals(claimOf([otpOptionsOf(sms.authProvider)]), false)
})

Deno.test('recovery: the code of a non-email channel is stored under a channel-scoped target', async () => {
  const { service, authProvider } = build(PasswordService, {
    auth: baseAuth({ otpNotifier: 'sms', phone: { unmask: () => '+5215512345678' } }),
  })
  await service.recovery('jane@example.com', { isLogin: true })
  assertEquals(authProvider.otp.generate.calls[0]?.[0].target, 'auth-1:sms')

  const email = build(PasswordService)
  await email.service.recovery('jane@example.com', { isLogin: true })
  assertEquals(email.authProvider.otp.generate.calls[0]?.[0].target, 'auth-1')
})

// --- step-up ---------------------------------------------------------------------------------

Deno.test('step-up verify: an email code records the proof, an SMS code does not', async () => {
  const stepUpKeys = await import('../../helpers/step-up.ts')
  await stepUpKeys.withStepUpKeys(async () => {
    const email = build(StepUpService)
    await generateOTP(email.cache as never, { target: stepUpOtpTarget('purpose', 'auth-1') })
    await email.service.verify(
      'purpose',
      email.cache.local.get('zanix:otp:step-up:purpose:auth-1') as string,
    )
    assertEquals(email.authRepo.markEmailVerified.calls.length, 1)

    const sms = build(StepUpService)
    await generateOTP(sms.cache as never, { target: stepUpOtpTarget('purpose', 'auth-1', 'sms') })
    await sms.service.verify(
      'purpose',
      sms.cache.local.get('zanix:otp:step-up:purpose:auth-1:sms') as string,
    )
    assertEquals(sms.authRepo.markEmailVerified.calls.length, 0)
  })
})

// --- OAuth2 ----------------------------------------------------------------------------------

function withConnector(service: AuthService, userInfo: Record<string, unknown>) {
  mockAccessor(
    service,
    'getOauthConnector',
    fn(() => ({ validateCode: fn(() => userInfo) })),
  )
}

Deno.test('loginWithOauthCallback: a provider-verified email records the proof and carries email_verified', async () => {
  const { service, authRepo, authProvider } = build(AuthService, {
    auth: baseAuth({ oauthProvider: 'google' }),
  })
  withConnector(service, { email: 'jane@example.com', verified_email: true })

  await service.loginWithOauthCallback('code', 'google')

  assertEquals(authRepo.markEmailVerified.calls.length, 1)
  assertEquals(claimOf(authProvider.session.generateTokens.calls[0]), true)
})

Deno.test('loginWithOauthCallback: an email the provider does not flag as verified proves nothing', async () => {
  const { service, authRepo, authProvider } = build(AuthService, {
    auth: baseAuth({ oauthProvider: 'github' }),
  })
  // GitHub's user info carries no verification flag at all.
  withConnector(service, { email: 'jane@example.com' })

  await service.loginWithOauthCallback('code', 'github')

  assertEquals(authRepo.markEmailVerified.calls.length, 0)
  assertEquals(claimOf(authProvider.session.generateTokens.calls[0]), false)
})

Deno.test('loginWithOauthCallback: an already verified account keeps the claim when the provider sends no flag', async () => {
  const { service, authRepo, authProvider } = build(AuthService, {
    auth: baseAuth({ oauthProvider: 'github', emailVerifiedAt: new Date() }),
  })
  withConnector(service, { email: 'jane@example.com' })

  await service.loginWithOauthCallback('code', 'github')

  assertEquals(authRepo.markEmailVerified.calls.length, 0)
  assertEquals(claimOf(authProvider.session.generateTokens.calls[0]), true)
})

Deno.test('loginWithOauthCallback: a failing write does not fail the sign-in', async () => {
  const { service } = build(AuthService, {
    auth: baseAuth({ oauthProvider: 'google' }),
    markEmailVerified: () => Promise.reject(new Error('database unavailable')),
  })
  withConnector(service, { email: 'jane@example.com', verified_email: true })

  const result = await service.loginWithOauthCallback('code', 'google') as Record<string, unknown>
  assertEquals(result.accessToken, 'access')
})

Deno.test('loginWithOauthCallback: a new verified account is created with the proof recorded', async () => {
  let lookups = 0
  const { service, authRepo } = build(AuthService)
  authRepo.findByEmail = fn((..._args: unknown[]): unknown =>
    lookups++ === 0 ? undefined : baseAuth({ oauthProvider: 'google', emailVerifiedAt: new Date() })
  )
  mockAccessor(
    service,
    'providers',
    mapGetter([
      [AuthRepository, authRepo],
      [
        ZanixAuthProvider,
        { session: { generateTokens: fn(() => ({ accessToken: 'access', refreshToken: 'r' })) } },
      ],
      [NotifierProvider, { email: fn(() => {}) }],
      [UsersRepository, {
        registerUser: fn(() => ({ id: 'user-1' })),
        findById: fn(() => ({ status: 'ACTIVE' })),
      }],
      [RolesRepository, { findManyWithPermissions: fn(() => []) }],
      claimProviderEntry(),
    ]),
  )
  withConnector(service, { email: 'new@example.com', verified_email: true })

  await service.loginWithOauthCallback('code', 'google')

  const registered = authRepo.registerAuth.calls[0]?.[0] as Record<string, unknown>
  assert(registered.emailVerifiedAt instanceof Date)
})

// --- the claim on every other issuance path --------------------------------------------------

Deno.test('the email_verified claim follows the account on password login, TOTP login, session exchange and refresh', async () => {
  for (const verified of [false, true]) {
    const emailVerifiedAt = verified ? new Date('2026-01-01T00:00:00Z') : undefined
    const totpSecret = { decrypt: () => 'SECRET' }
    const { service, authProvider } = build(AuthService, {
      auth: baseAuth({ emailVerifiedAt, totpSecret }),
    })

    await service.loginWithPassword('jane@example.com', 'pw')
    assertEquals(claimOf(authProvider.session.generateTokens.calls[0]), verified, 'password')

    await service.issueSessionForSubject('auth-1')
    assertEquals(claimOf(authProvider.session.generateTokens.calls[1]), verified, 'exchange')

    await service.loginWithTOTPCallback('jane@example.com', '123456')
    assertEquals(claimOf(authProvider.totp.authenticate.calls[0], 2), verified, 'totp')

    const token = `${btoa('{"alg":"HS256"}')}.${btoa('{"sub":"auth-1"}')}.sig`
    await service.refreshTokens(token)
    assertEquals(claimOf(authProvider.session.refreshTokens.calls[0], 1), verified, 'refresh')
  }
})

// --- getOwnAuthMethods -----------------------------------------------------------------------

Deno.test('getOwnAuthMethods: reports emailVerified and the ISO emailVerifiedAt once proven', async () => {
  const proven = build(AuthService, {
    auth: baseAuth({ emailVerifiedAt: new Date('2026-03-04T05:06:07.000Z') }),
  })
  const result = await proven.service.getOwnAuthMethods()
  assertEquals(result.emailVerified, true)
  assertEquals(result.emailVerifiedAt, '2026-03-04T05:06:07.000Z')

  const unproven = build(AuthService)
  const unprovenResult = await unproven.service.getOwnAuthMethods()
  assertEquals(unprovenResult.emailVerified, false)
  assertEquals('emailVerifiedAt' in unprovenResult, false)
})
