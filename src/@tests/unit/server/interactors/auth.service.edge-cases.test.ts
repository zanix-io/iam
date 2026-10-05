import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'
import { createJWT, JWT_KEY_ENV, ZanixAuthProvider } from '@zanix/auth'
import { NotifierProvider } from '@zanix/notifications'
import { setConfigOverride } from '@zanix/app/runtime'

import { AuthService } from 'server/interactors/auth.interactor.ts'
import { PasswordService } from 'server/interactors/password.interactor.ts'
import { AuthRepository } from 'server/repositories/auth/entity.provider.ts'
import { UsersRepository } from 'server/repositories/users/entity.provider.ts'
import { RolesRepository } from 'server/repositories/roles/entity.provider.ts'
import {
  ACCESS_TOKEN_EXPIRATION_ENV,
  REACTIVATION_TOKEN_PURPOSE,
  REFRESH_TOKEN_EXPIRATION_ENV,
} from 'utils/constants.ts'
import { fn, mapGetter, mockAccessor } from '../../helpers/mock.ts'

/**
 * `AuthService` branches not exercised by `auth.service.test.ts`: the plain (non-2FA) OTP
 * dispatch, missing-record and missing-configuration failures, the configured TOTP tolerance
 * window, token-expiration pass-through on the self-provisioning and direct-issue paths, and the
 * masked phone summary. Same isolation approach as that file: every provider/interactor is a
 * recorder shadowed onto the instance.
 */

async function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const originals = Object.fromEntries(Object.keys(values).map((key) => [key, Deno.env.get(key)]))
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) Deno.env.delete(key)
    else Deno.env.set(key, value)
  }
  try {
    await run()
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) Deno.env.delete(key)
      else Deno.env.set(key, value)
    }
  }
}

const auth = (overrides: Record<string, unknown> = {}) => ({
  id: 'auth-1',
  userId: 'user-1',
  email: { unmask: () => 'jane@example.com' },
  ...overrides,
})

function buildService(opts: {
  authRepo?: Record<string, unknown>
  usersRepo?: Record<string, unknown>
  authProvider?: Record<string, unknown>
  passwordService?: Record<string, unknown>
  session?: Record<string, unknown>
  cookies?: Record<string, string>
} = {}) {
  const authRepo = {
    findByEmail: fn((..._args: unknown[]): unknown => auth()),
    findById: fn((..._args: unknown[]): unknown => auth()),
    registerAuth: fn((..._args: unknown[]) => ({})),
    updateAuth: fn((..._args: unknown[]) => ({})),
    ...opts.authRepo,
  }
  const usersRepo = {
    registerUser: fn((..._args: unknown[]) => ({ id: 'user-1' })),
    assertActive: fn((..._args: unknown[]) => {}),
    findById: fn((..._args: unknown[]): unknown => ({ status: 'ACTIVE' })),
    reactivate: fn((..._args: unknown[]) => ({})),
    ...opts.usersRepo,
  }
  const tokens = { accessToken: 'access', refreshToken: 'refresh' }
  const authProvider = {
    session: {
      generateTokens: fn((..._args: unknown[]) => tokens),
      refreshTokens: fn((..._args: unknown[]) => ({ ...tokens, oldToken: 'x', payload: {} })),
    },
    otp: {
      verify: fn((..._args: unknown[]) => true),
      authenticate: fn((..._args: unknown[]) => tokens),
    },
    totp: {
      verify: fn((..._args: unknown[]) => true),
      authenticate: fn((..._args: unknown[]) => tokens),
    },
    ...opts.authProvider,
  }
  const passwordService = {
    recovery: fn((..._args: unknown[]) => ({ response: 'notification sent' })),
    ...opts.passwordService,
  }
  const notifier = { email: fn((..._args: unknown[]) => {}) }

  const service = new AuthService('ctx-1')
  mockAccessor(
    service,
    'providers',
    mapGetter([
      [AuthRepository, authRepo],
      [UsersRepository, usersRepo],
      [ZanixAuthProvider, authProvider],
      [NotifierProvider, notifier],
      [RolesRepository, { findManyWithPermissions: () => [] }],
    ]),
  )
  mockAccessor(service, 'interactors', mapGetter([[PasswordService, passwordService]]))
  mockAccessor(service, 'context', {
    session: opts.session ?? { subject: 'auth-1' },
    cookies: opts.cookies ?? {},
  })
  return { service, authRepo, usersRepo, authProvider, passwordService }
}

Deno.test('loginWithOTP: a plain (non-2FA) request returns the dispatch result and forwards the notifier override', async () => {
  const { service, passwordService } = buildService()
  const result = await service.loginWithOTP('jane@example.com', { notifier: 'whatsapp' })
  assertEquals(result, { response: 'notification sent' })
  assertEquals(passwordService.recovery.calls, [[
    'jane@example.com',
    { isLogin: true, notifier: 'whatsapp' },
  ]])
})

Deno.test('loginWithOTP: called with no options dispatches through the account default channel', async () => {
  const { service, passwordService } = buildService()
  await service.loginWithOTP('jane@example.com')
  assertEquals(passwordService.recovery.calls[0][1], { isLogin: true, notifier: undefined })
})

Deno.test('loginWithOTPCallback: reactivating an INACTIVE account with no JWT key configured fails as a server misconfiguration', async () => {
  await withEnv({ [JWT_KEY_ENV]: undefined }, async () => {
    const { service } = buildService({
      usersRepo: { findById: fn(() => ({ status: 'INACTIVE' })) },
    })
    await assertRejects(
      () => service.loginWithOTPCallback('jane@example.com', '123456'),
      HttpError,
      'Authentication is not configured correctly.',
    )
  })
})

Deno.test('loginWithOTPCallback: self-provisioning passes configured access/refresh expirations to the new session', async () => {
  await withEnv(
    { [ACCESS_TOKEN_EXPIRATION_ENV]: '15m', [REFRESH_TOKEN_EXPIRATION_ENV]: '7d' },
    async () => {
      let lookups = 0
      const { service, authProvider } = buildService({
        authRepo: { findByEmail: fn(() => (lookups++ === 0 ? undefined : auth())) },
      })
      await service.loginWithOTPCallback('new@example.com', '123456')
      const [options] = authProvider.session.generateTokens.calls[0] as [Record<string, unknown>]
      assertEquals([options.accessExpiration, options.refreshExpiration], ['15m', '7d'])
    },
  )
})

Deno.test('confirmReactivation: a valid token for an auth record that no longer exists is FORBIDDEN', async () => {
  await withEnv({ [JWT_KEY_ENV]: 'edge-case-secret' }, async () => {
    const token = await createJWT(
      { sub: 'auth-gone', purpose: REACTIVATION_TOKEN_PURPOSE },
      'edge-case-secret',
      { expiration: '10m' } as never,
    )
    const { service, usersRepo } = buildService({ authRepo: { findById: fn(() => undefined) } })
    await assertRejects(() => service.confirmReactivation(token), HttpError, 'no longer exists')
    assertEquals(usersRepo.reactivate.calls, [])
  })
})

Deno.test('setOtpNotifier: a session subject with no auth record is FORBIDDEN, nothing written', async () => {
  const { service, authRepo } = buildService({ authRepo: { findById: fn(() => undefined) } })
  await assertRejects(() => service.setOtpNotifier('sms'), HttpError, 'Account not found.')
  assertEquals(authRepo.updateAuth.calls, [])
})

Deno.test('loginWithTOTPCallback: an account with no TOTP secret is FORBIDDEN before any code check', async () => {
  const { service, authProvider } = buildService()
  await assertRejects(
    () => service.loginWithTOTPCallback('jane@example.com', '123456'),
    HttpError,
    'TOTP is not enabled for this account.',
  )
  assertEquals(authProvider.totp.authenticate.calls, [])
})

Deno.test('loginWithTOTPCallback/totpConfirm: a configured totpToleranceSteps is the verification window', async () => {
  setConfigOverride('auth', 'totpToleranceSteps', 3)
  try {
    const { service, authProvider } = buildService({
      authRepo: {
        findByEmail: fn(() => auth({ totpSecret: { decrypt: () => 'SECRET' } })),
        findById: fn(() => auth()),
      },
    })
    await service.loginWithTOTPCallback('jane@example.com', '123456')
    assertEquals(authProvider.totp.authenticate.calls[0][3], { window: 3 })

    await service.totpConfirm('SECRET', '123456')
    assertEquals(authProvider.totp.verify.calls[0], ['SECRET', '123456', { window: 3 }])
  } finally {
    setConfigOverride('auth', 'totpToleranceSteps', undefined)
  }
})

Deno.test('loginWithOauthCallback: selfRegistrationViaOAuth=false refuses an unknown email, provisioning nothing', async () => {
  setConfigOverride('auth', 'selfRegistrationViaOAuth', false)
  try {
    const { service, usersRepo, authRepo } = buildService({
      authRepo: { findByEmail: fn(() => undefined) },
    })
    mockAccessor(service, 'getOauthConnector', () => ({
      validateCode: () => ({ email: 'new@example.com', verified_email: true }),
    }))
    await assertRejects(
      () => service.loginWithOauthCallback('code', 'google'),
      HttpError,
      'No account exists for this email.',
    )
    assertEquals(usersRepo.registerUser.calls, [])
    assertEquals(authRepo.registerAuth.calls, [])
  } finally {
    setConfigOverride('auth', 'selfRegistrationViaOAuth', undefined)
  }
})

Deno.test('getOwnAuthMethods: a verified phone is summarized as its last 4 digits only', async () => {
  const { service } = buildService({
    authRepo: {
      findById: fn(() => auth({ phone: { unmask: () => '+14155551234' }, otpNotifier: 'sms' })),
    },
  })
  const summary = await service.getOwnAuthMethods() as Record<string, unknown>
  assertEquals(summary.phone, '••••1234')
  assertEquals(summary.otpNotifier, 'sms')
})

Deno.test('linkOauth: a session subject with no auth record is FORBIDDEN before calling the provider', async () => {
  const { service, authRepo } = buildService({ authRepo: { findById: fn(() => undefined) } })
  const validateCode = fn(() => ({ email: 'jane@example.com' }))
  mockAccessor(service, 'getOauthConnector', () => ({ validateCode }))
  await assertRejects(() => service.linkOauth('code', 'github'), HttpError, 'Account not found.')
  assertEquals(validateCode.calls, [])
  assertEquals(authRepo.updateAuth.calls, [])
})

Deno.test('issueSessionForSubject: passes configured access/refresh expirations to the session', async () => {
  await withEnv(
    { [ACCESS_TOKEN_EXPIRATION_ENV]: '20m', [REFRESH_TOKEN_EXPIRATION_ENV]: '14d' },
    async () => {
      const { service, authProvider } = buildService()
      await service.issueSessionForSubject('auth-1')
      const [options] = authProvider.session.generateTokens.calls[0] as [Record<string, unknown>]
      assertEquals([options.accessExpiration, options.refreshExpiration], ['20m', '14d'])
    },
  )
})

Deno.test('refreshTokens: with neither a body token nor a refresh cookie, no account is looked up and the refresh is FORBIDDEN', async () => {
  const { service, authRepo, authProvider } = buildService({ cookies: {} })
  await assertRejects(() => service.refreshTokens(), HttpError, 'Refresh token verification failed')
  assertEquals(authRepo.findById.calls, [])
  assertEquals(authProvider.session.refreshTokens.calls[0], [undefined, { permissions: [] }])
})

Deno.test('loginWithOTP: a 2FA dispatch with no explicit channel reports email as the challenge method', async () => {
  const { service } = buildService()
  const result = await service.loginWithOTP('jane@example.com', { is2FA: true })
  assertEquals(result, {
    message: 'Two-factor authentication is enabled. A verification code has been sent.',
    email: 'jane@example.com',
    method: 'email',
  })
})

Deno.test('totpConfirm: throws UNAUTHORIZED with no session, verifying nothing', async () => {
  const { service, authProvider } = buildService({ session: {} })
  await assertRejects(
    () => service.totpConfirm('SECRET', '123456'),
    HttpError,
    'Authentication required.',
  )
  assertEquals(authProvider.totp.verify.calls, [])
})
