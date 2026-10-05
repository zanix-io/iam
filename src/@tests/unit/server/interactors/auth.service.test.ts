import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'
import { createJWT, ZanixAuthProvider } from '@zanix/auth'
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
  password: { verify: () => true },
  twoFactorAuthConfig: undefined,
  totpSecret: undefined,
  ...overrides,
})

/**
 * A structurally real (base64url-shaped), but unsigned/unverified, JWT string — `AuthService`'s
 * own `decodeRefreshSubject` calls the real `decodeJWT` (an unverified peek, never signature
 * verification), so a bare fixture string like `'old-token'` fails to decode and every
 * `refreshTokens` test below needs an actual decodable token to exercise the pre-lookup, not just
 * whatever `authProvider.session.refreshTokens`'s own mock happens to return afterward.
 */
const base64Url = (input: string) =>
  btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fakeRefreshToken = (sub: string) =>
  `${base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${
    base64Url(JSON.stringify({ sub }))
  }.sig`

const defaultAuthRepo = () => ({
  findByEmail: fn((..._args: unknown[]): unknown => baseAuth()),
  findById: fn((..._args: unknown[]): unknown => baseAuth()),
  registerAuth: fn((..._args: unknown[]) => ({})),
  updateAuth: fn((..._args: unknown[]) => ({})),
})

const defaultAuthProvider = () => ({
  session: {
    generateTokens: fn((..._args: unknown[]) => ({
      accessToken: 'access',
      refreshToken: 'refresh',
    })),
    refreshTokens: fn((..._args: unknown[]) => ({
      oldToken: 'old',
      payload: { sub: 'auth-1' },
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    })),
    revokeToken: fn((..._args: unknown[]) => {}),
  },
  totp: {
    generateSecret: fn((..._args: unknown[]) => 'SECRET'),
    getProvisioningUri: fn((..._args: unknown[]) => 'otpauth://totp/...'),
    verify: fn((..._args: unknown[]) => true),
    authenticate: fn((..._args: unknown[]) => ({ accessToken: 'access', refreshToken: 'refresh' })),
  },
  otp: {
    generate: fn((..._args: unknown[]) => '123456'),
    verify: fn((..._args: unknown[]) => true),
    authenticate: fn((..._args: unknown[]) => ({ accessToken: 'access', refreshToken: 'refresh' })),
  },
})

const defaultNotifier = () => ({
  email: fn((..._args: unknown[]) => {}),
  sendMessage: fn((..._args: unknown[]) => {}),
})

const defaultUsersRepo = () => ({
  registerUser: fn((..._args: unknown[]): unknown => ({ id: 'user-1' })),
  assertActive: fn((..._args: unknown[]) => {}),
  findById: fn((..._args: unknown[]): unknown => ({ status: 'ACTIVE' })),
  reactivate: fn((..._args: unknown[]) => ({})),
})

const defaultRolesRepo = () => ({
  findManyWithPermissions: fn((..._args: unknown[]): unknown => []),
})

const defaultPasswordService = () => ({
  recovery: fn((..._args: unknown[]) => ({ response: 'notification sent' })),
})

function buildService(opts: {
  authRepo?: Partial<ReturnType<typeof defaultAuthRepo>>
  authProvider?: Partial<ReturnType<typeof defaultAuthProvider>>
  notifier?: Partial<ReturnType<typeof defaultNotifier>>
  passwordService?: Partial<ReturnType<typeof defaultPasswordService>>
  usersRepo?: Partial<ReturnType<typeof defaultUsersRepo>>
  rolesRepo?: Partial<ReturnType<typeof defaultRolesRepo>>
  session?: Record<string, unknown>
  cookies?: Record<string, string>
} = {}) {
  const authRepo = { ...defaultAuthRepo(), ...opts.authRepo }
  const authProvider = { ...defaultAuthProvider(), ...opts.authProvider }
  const notifier = { ...defaultNotifier(), ...opts.notifier }
  const passwordService = { ...defaultPasswordService(), ...opts.passwordService }
  const usersRepo = { ...defaultUsersRepo(), ...opts.usersRepo }
  const rolesRepo = { ...defaultRolesRepo(), ...opts.rolesRepo }

  const service = new AuthService('ctx-1')
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
  mockAccessor(service, 'interactors', mapGetter([[PasswordService, passwordService]]))
  mockAccessor(service, 'context', {
    session: opts.session ?? { subject: 'auth-1' },
    cookies: opts.cookies ?? {},
  })

  return { service, authRepo, authProvider, notifier, passwordService, usersRepo, rolesRepo }
}

Deno.test('loginWithPassword: throws FORBIDDEN when no account exists for the email', async () => {
  const { service } = buildService({
    authRepo: { findByEmail: fn(() => undefined) },
  })
  await assertRejects(
    () => service.loginWithPassword('nobody@example.com', 'x'),
    HttpError,
    'Invalid email or password',
  )
})

Deno.test('loginWithPassword: throws FORBIDDEN when the password does not verify', async () => {
  const { service } = buildService({
    authRepo: { findByEmail: fn(() => baseAuth({ password: { verify: () => false } })) },
  })
  await assertRejects(
    () => service.loginWithPassword('jane@example.com', 'wrong'),
    HttpError,
    'Invalid email or password',
  )
})

Deno.test('loginWithPassword: short-circuits into OTP dispatch when 2FA triggers on login', async () => {
  const { service, passwordService } = buildService({
    authRepo: {
      findByEmail: fn(() =>
        baseAuth({ twoFactorAuthConfig: { method: 'email', triggerOn: ['login'] } })
      ),
    },
  })
  const result = await service.loginWithPassword('jane@example.com', 'secret')
  assertEquals(result, {
    message: 'Two-factor authentication is enabled. A verification code has been sent.',
    email: 'jane@example.com',
    method: 'email',
  })
  assertEquals(passwordService.recovery.calls[0], [
    'jane@example.com',
    { isLogin: true, notifier: 'email' },
  ])
})

Deno.test('loginWithPassword: TOTP 2FA returns a distinct message, never an OTP dispatch', async () => {
  const { service, passwordService } = buildService({
    authRepo: {
      findByEmail: fn(() =>
        baseAuth({ twoFactorAuthConfig: { method: 'totp', triggerOn: ['login'] } })
      ),
    },
  })
  const result = await service.loginWithPassword('jane@example.com', 'secret')
  assertEquals(result, {
    message: 'Two-factor authentication is enabled. Enter your authenticator code.',
    email: 'jane@example.com',
    method: 'totp',
  })
  assertEquals(passwordService.recovery.calls.length, 0)
})

Deno.test('loginWithPassword: on success returns tokens and records lastLoginAt', async () => {
  const { service, authRepo } = buildService()
  const result = await service.loginWithPassword('jane@example.com', 'secret') as Record<
    string,
    unknown
  >
  assertEquals(result.accessToken, 'access')
  assertEquals(authRepo.updateAuth.calls.length, 1)
  const update = authRepo.updateAuth.calls[0]?.[0] as Record<string, unknown>
  assert(update.lastLoginAt instanceof Date)
  // The issued tokens are never mirrored into this project's own storage — `@zanix/auth`'s own
  // JWT + blocklist mechanism is the sole source of truth for session validity (see
  // `AuthService.refreshTokens`'s own doc for why a separate, locally stored token hash was
  // removed).
  assertEquals('systemRefreshToken' in update, false)
})

Deno.test('finishLogin (via loginWithPassword): omits accessExpiration/refreshExpiration when neither env var is configured', async () => {
  await withEnv(ACCESS_TOKEN_EXPIRATION_ENV, undefined, async () => {
    await withEnv(REFRESH_TOKEN_EXPIRATION_ENV, undefined, async () => {
      const { service, authProvider } = buildService()
      await service.loginWithPassword('jane@example.com', 'secret')
      const options = authProvider.session.generateTokens.calls[0]?.[0] as Record<string, unknown>
      assertEquals('accessExpiration' in options, false)
      assertEquals('refreshExpiration' in options, false)
    })
  })
})

Deno.test('finishLogin (via loginWithPassword): passes accessExpiration when ACCESS_TOKEN_EXPIRATION is configured', async () => {
  await withEnv(ACCESS_TOKEN_EXPIRATION_ENV, '30m', async () => {
    const { service, authProvider } = buildService()
    await service.loginWithPassword('jane@example.com', 'secret')
    const options = authProvider.session.generateTokens.calls[0]?.[0] as Record<string, unknown>
    assertEquals(options.accessExpiration, '30m')
    assertEquals('refreshExpiration' in options, false)
  })
})

Deno.test('finishLogin (via loginWithPassword): passes refreshExpiration when REFRESH_TOKEN_EXPIRATION is configured', async () => {
  await withEnv(REFRESH_TOKEN_EXPIRATION_ENV, '30d', async () => {
    const { service, authProvider } = buildService()
    await service.loginWithPassword('jane@example.com', 'secret')
    const options = authProvider.session.generateTokens.calls[0]?.[0] as Record<string, unknown>
    assertEquals(options.refreshExpiration, '30d')
    assertEquals('accessExpiration' in options, false)
  })
})

Deno.test('loginWithPassword: no role assigned embeds an empty permissions list, and never queries RolesRepository', async () => {
  const { service, authProvider, rolesRepo } = buildService()
  await service.loginWithPassword('jane@example.com', 'secret')
  assertEquals(
    (authProvider.session.generateTokens.calls[0]?.[0] as { permissions?: string[] }).permissions,
    [],
  )
  assertEquals(rolesRepo.findManyWithPermissions.calls.length, 0)
})

Deno.test('loginWithPassword: with a role assigned, embeds its resolved active permissions', async () => {
  const { service, authProvider, rolesRepo } = buildService({
    authRepo: { findByEmail: fn(() => baseAuth({ roleIds: ['role-1'] })) },
    rolesRepo: {
      findManyWithPermissions: fn(() => [{
        id: 'role-1',
        permissions: [
          { id: 'p1', code: 'zanix-iam:role-read', isActive: true },
          { id: 'p2', code: 'zanix-iam:role-write', isActive: false },
        ],
      }]),
    },
  })
  await service.loginWithPassword('jane@example.com', 'secret')
  assertEquals(rolesRepo.findManyWithPermissions.calls[0], [['role-1']])
  assertEquals(
    (authProvider.session.generateTokens.calls[0]?.[0] as { permissions?: string[] }).permissions,
    ['zanix-iam:role-read'],
  )
})

Deno.test('loginWithPassword: with several roles, embeds the union of their permissions without repeats', async () => {
  const roles: Record<string, unknown> = {
    'role-web': {
      id: 'role-web',
      permissions: [{ id: 'p1', code: 'web:user', isActive: true }],
    },
    'role-seller': {
      id: 'role-seller',
      permissions: [
        { id: 'p1', code: 'web:user', isActive: true },
        { id: 'p2', code: 'seller:manage', isActive: true },
        { id: 'p3', code: 'seller:off', isActive: false },
      ],
    },
  }
  const { service, authProvider, rolesRepo } = buildService({
    authRepo: { findByEmail: fn(() => baseAuth({ roleIds: ['role-web', 'role-seller'] })) },
    rolesRepo: {
      findManyWithPermissions: fn((ids: unknown) => (ids as string[]).map((id) => roles[id])),
    },
  })
  await service.loginWithPassword('jane@example.com', 'secret')
  assertEquals(rolesRepo.findManyWithPermissions.calls, [[['role-web', 'role-seller']]])
  assertEquals(
    (authProvider.session.generateTokens.calls[0]?.[0] as { permissions?: string[] }).permissions,
    ['web:user', 'seller:manage'],
  )
})

Deno.test('loginWithPassword: a role that no longer exists adds nothing and the others still apply', async () => {
  const { service, authProvider } = buildService({
    authRepo: { findByEmail: fn(() => baseAuth({ roleIds: ['gone', 'role-1'] })) },
    rolesRepo: {
      findManyWithPermissions: fn(
        () => [{ id: 'role-1', permissions: [{ id: 'p1', code: 'web:user', isActive: true }] }],
      ),
    },
  })
  await service.loginWithPassword('jane@example.com', 'secret')
  assertEquals(
    (authProvider.session.generateTokens.calls[0]?.[0] as { permissions?: string[] }).permissions,
    ['web:user'],
  )
})

Deno.test('loginWithOTPCallback: embeds the resolved role permissions', async () => {
  const { service, authProvider } = buildService({
    authRepo: { findByEmail: fn(() => baseAuth({ roleIds: ['role-1'] })) },
    rolesRepo: {
      findManyWithPermissions: fn(() => [{
        id: 'role-1',
        permissions: [{ id: 'p1', code: 'zanix-iam:role-read', isActive: true }],
      }]),
    },
  })
  await service.loginWithOTPCallback('jane@example.com', '123456')
  assertEquals(
    (authProvider.otp.authenticate.calls[0]?.[2] as { permissions?: string[] }).permissions,
    ['zanix-iam:role-read'],
  )
})

Deno.test('loginWithOTPCallback: omits accessExpiration/refreshExpiration when neither env var is configured', async () => {
  await withEnv(ACCESS_TOKEN_EXPIRATION_ENV, undefined, async () => {
    await withEnv(REFRESH_TOKEN_EXPIRATION_ENV, undefined, async () => {
      const { service, authProvider } = buildService()
      await service.loginWithOTPCallback('jane@example.com', '123456')
      const options = authProvider.otp.authenticate.calls[0]?.[2] as Record<string, unknown>
      assertEquals('accessExpiration' in options, false)
      assertEquals('refreshExpiration' in options, false)
    })
  })
})

Deno.test('loginWithOTPCallback: passes accessExpiration when ACCESS_TOKEN_EXPIRATION is configured', async () => {
  await withEnv(ACCESS_TOKEN_EXPIRATION_ENV, '30m', async () => {
    const { service, authProvider } = buildService()
    await service.loginWithOTPCallback('jane@example.com', '123456')
    const options = authProvider.otp.authenticate.calls[0]?.[2] as Record<string, unknown>
    assertEquals(options.accessExpiration, '30m')
    assertEquals('refreshExpiration' in options, false)
  })
})

Deno.test('loginWithOTPCallback: passes refreshExpiration when REFRESH_TOKEN_EXPIRATION is configured', async () => {
  await withEnv(REFRESH_TOKEN_EXPIRATION_ENV, '30d', async () => {
    const { service, authProvider } = buildService()
    await service.loginWithOTPCallback('jane@example.com', '123456')
    const options = authProvider.otp.authenticate.calls[0]?.[2] as Record<string, unknown>
    assertEquals(options.refreshExpiration, '30d')
    assertEquals('accessExpiration' in options, false)
  })
})

Deno.test('loginWithOTPCallback: no existing account self-provisions via a verified email-keyed code, then mints a real session', async () => {
  // Unset on the FIRST lookup (no account yet), then re-fetched as the just-created record on the
  // SECOND — same reasoning as `loginWithOauthCallback`'s own identical re-fetch.
  let lookups = 0
  const { service, authRepo, authProvider, usersRepo, notifier } = buildService({
    authRepo: {
      findByEmail: fn((..._args: unknown[]): unknown =>
        lookups++ === 0 ? undefined : baseAuth({ id: 'auth-new', userId: 'user-1' })
      ),
    },
  })

  const result = await service.loginWithOTPCallback(
    'new@example.com',
    '123456',
  ) as Record<string, unknown>

  // Verified against the SAME email-keyed target `PasswordService.recovery`'s own
  // self-registration dispatch generated the code against — never `.authenticate`, which would
  // mint a session with the email itself as `subject`.
  assertEquals(authProvider.otp.verify.calls[0], ['new@example.com', '123456'])
  assertEquals(authProvider.otp.authenticate.calls.length, 0)

  assertEquals(usersRepo.registerUser.calls[0], [{}])
  const registered = authRepo.registerAuth.calls[0]?.[0] as Record<string, unknown>
  assertEquals(registered.email, 'new@example.com')
  assertEquals(registered.userId, 'user-1')
  assertEquals('password' in registered, false)
  assertEquals('oauthProvider' in registered, false)
  assertEquals(notifier.email.calls[0]?.[0], {
    to: 'new@example.com',
    subject: 'Welcome to zanix-iam',
    zanixTemplate: 'welcome',
    data: {},
  })

  // A real session for the just-created account's own id — never the plain email.
  assertEquals(authProvider.session.generateTokens.calls[0]?.[0], {
    subject: 'auth-new',
    permissions: [],
  })
  assertEquals(authRepo.findByEmail.calls.length, 2)
  assertEquals(result.accessToken, 'access')
})

Deno.test("loginWithOTPCallback: self-provisioning assigns auth.app.ts's configured defaultRoleId, so a new account starts with that role's permissions", async () => {
  setConfigOverride('auth', 'defaultRoleId', 'role-default-member')
  try {
    let lookups = 0
    const { service, authRepo } = buildService({
      authRepo: {
        findByEmail: fn((..._args: unknown[]): unknown =>
          lookups++ === 0 ? undefined : baseAuth({ id: 'auth-new', userId: 'user-1' })
        ),
      },
    })

    await service.loginWithOTPCallback('new@example.com', '123456')

    const registered = authRepo.registerAuth.calls[0]?.[0] as Record<string, unknown>
    assertEquals(registered.roleIds, ['role-default-member'])
  } finally {
    setConfigOverride('auth', 'defaultRoleId', '')
  }
})

Deno.test('loginWithOTPCallback: with no defaultRoleId configured, self-provisioning passes roleIds undefined', async () => {
  let lookups = 0
  const { service, authRepo } = buildService({
    authRepo: {
      findByEmail: fn((..._args: unknown[]): unknown =>
        lookups++ === 0 ? undefined : baseAuth({ id: 'auth-new', userId: 'user-1' })
      ),
    },
  })

  await service.loginWithOTPCallback('new@example.com', '123456')

  const registered = authRepo.registerAuth.calls[0]?.[0] as Record<string, unknown>
  assertEquals(registered.roleIds, undefined)
})

Deno.test('loginWithOTPCallback: no existing account, invalid code, never provisions anything', async () => {
  const { service, authProvider, usersRepo, authRepo } = buildService({
    authRepo: { findByEmail: fn((..._args: unknown[]): unknown => undefined) },
    authProvider: {
      otp: {
        generate: fn((..._args: unknown[]) => '123456'),
        verify: fn(() => false),
        authenticate: fn(() => ({ accessToken: '', refreshToken: '' })),
      },
    },
  })

  await assertRejects(
    () => service.loginWithOTPCallback('new@example.com', '000000'),
    HttpError,
    'Invalid email or code',
  )
  assertEquals(usersRepo.registerUser.calls.length, 0)
  assertEquals(authRepo.registerAuth.calls.length, 0)
  assertEquals(authProvider.otp.authenticate.calls.length, 0)
})

Deno.test(
  'loginWithOTPCallback: a VALID code against an INACTIVE account returns a reactivation ' +
    'challenge instead of reactivating or finishing login',
  async () => {
    await withEnv('JWT_KEY', 'test-secret', async () => {
      const { service, usersRepo } = buildService({
        authRepo: { findByEmail: fn(() => baseAuth({ userId: 'user-1', id: 'auth-1' })) },
        usersRepo: { findById: fn(() => ({ status: 'INACTIVE' })) },
      })
      const result = await service.loginWithOTPCallback('jane@example.com', '123456')
      assertEquals(result, {
        needsReactivationConfirm: true,
        reactivationToken: (result as { reactivationToken: string }).reactivationToken,
      })
      assert(typeof (result as { reactivationToken: string }).reactivationToken === 'string')
      // Never reactivated, never finished login — only `confirmReactivation` (given this exact
      // token back) does either.
      assertEquals(usersRepo.reactivate.calls.length, 0)
    })
  },
)

Deno.test('loginWithOTPCallback: an INVALID code never reactivates (or reveals the status of) an INACTIVE account', async () => {
  // Reactivation happens only AFTER `otp.authenticate` verifies the code; otherwise anyone could
  // reactivate (or probe the status of) an inactive account with just its email.
  const { service, usersRepo } = buildService({
    authRepo: { findByEmail: fn(() => baseAuth({ userId: 'user-1' })) },
    usersRepo: { findById: fn(() => ({ status: 'INACTIVE' })) },
    authProvider: {
      otp: {
        ...defaultAuthProvider().otp,
        authenticate: fn(() => {
          throw new HttpError('FORBIDDEN', { message: 'Invalid or expired code.' })
        }),
      },
    },
  })
  await assertRejects(
    () => service.loginWithOTPCallback('jane@example.com', '000000'),
    HttpError,
  )
  assertEquals(usersRepo.reactivate.calls.length, 0)
})

Deno.test('loginWithOTPCallback: still hard-blocks a DELETED existing account, never checking/authenticating the code or reactivating', async () => {
  const { service, usersRepo, authProvider } = buildService({
    authRepo: { findByEmail: fn(() => baseAuth({ userId: 'user-1' })) },
    usersRepo: { findById: fn(() => ({ status: 'DELETED' })) },
  })
  await assertRejects(
    () => service.loginWithOTPCallback('jane@example.com', '123456'),
    HttpError,
    'no longer exists',
  )
  assertEquals(authProvider.otp.authenticate.calls.length, 0)
  assertEquals(usersRepo.reactivate.calls.length, 0)
})

// -- loginWithOTPCallback: 2FA enforcement ------------------------------------------------------
// A direct OTP login honors `twoFactorAuthConfig` the same way `loginWithPassword`/
// `confirmReactivation` do through `finishLogin`: when a second factor different from the OTP
// channel is configured for login, it returns that challenge instead of tokens. These mirror
// `finishLogin`'s 2FA tests above.

Deno.test(
  'loginWithOTPCallback: TOTP 2FA returns the challenge message, never tokens, never persists a session',
  async () => {
    const { service, authRepo } = buildService({
      authRepo: {
        findByEmail: fn(() =>
          baseAuth({
            userId: 'user-1',
            twoFactorAuthConfig: { method: 'totp', triggerOn: ['login'] },
          })
        ),
      },
    })
    const result = await service.loginWithOTPCallback('jane@example.com', '123456')
    assertEquals(result, {
      message: 'Two-factor authentication is enabled. Enter your authenticator code.',
      email: 'jane@example.com',
      method: 'totp',
    })
    assertEquals(authRepo.updateAuth.calls.length, 0)
  },
)

Deno.test(
  "loginWithOTPCallback: a notifier-based 2FA method DIFFERENT from the account's own otpNotifier " +
    'preference (default email) short-circuits into a fresh OTP dispatch through that 2FA channel',
  async () => {
    const { service, authRepo, passwordService } = buildService({
      authRepo: {
        findByEmail: fn(() =>
          baseAuth({
            userId: 'user-1',
            twoFactorAuthConfig: { method: 'whatsapp', triggerOn: ['login'] },
          })
        ),
      },
    })
    const result = await service.loginWithOTPCallback('jane@example.com', '123456')
    assertEquals(result, {
      message: 'Two-factor authentication is enabled. A verification code has been sent.',
      email: 'jane@example.com',
      method: 'whatsapp',
    })
    assertEquals(passwordService.recovery.calls[0], [
      'jane@example.com',
      { isLogin: true, notifier: 'whatsapp' },
    ])
    assertEquals(authRepo.updateAuth.calls.length, 0)
  },
)

Deno.test(
  "loginWithOTPCallback: a notifier-based 2FA method THE SAME AS the account's own otpNotifier " +
    'is never asked again — the code just verified already proves control of that channel',
  async () => {
    const { service, authRepo, passwordService } = buildService({
      authRepo: {
        findByEmail: fn(() =>
          baseAuth({
            userId: 'user-1',
            otpNotifier: 'sms',
            twoFactorAuthConfig: { method: 'sms', triggerOn: ['login'] },
          })
        ),
      },
    })
    const result = await service.loginWithOTPCallback('jane@example.com', '123456') as Record<
      string,
      unknown
    >
    assertEquals(result.accessToken, 'access')
    assertEquals(passwordService.recovery.calls.length, 0)
    assertEquals(authRepo.updateAuth.calls.length, 1)
  },
)

Deno.test(
  "loginWithOTPCallback: 2FA not configured to trigger on 'login' is never asked, even with a " +
    'different method configured',
  async () => {
    const { service, authRepo } = buildService({
      authRepo: {
        findByEmail: fn(() =>
          baseAuth({
            userId: 'user-1',
            twoFactorAuthConfig: { method: 'totp', triggerOn: ['refresh'] },
          })
        ),
      },
    })
    const result = await service.loginWithOTPCallback('jane@example.com', '123456') as Record<
      string,
      unknown
    >
    assertEquals(result.accessToken, 'access')
    assertEquals(authRepo.updateAuth.calls.length, 1)
  },
)

Deno.test(
  'loginWithOTPCallback: an INACTIVE account with TOTP 2FA configured still returns the ' +
    "reactivation challenge first — 2FA is re-checked later, by confirmReactivation's own finishLogin call",
  async () => {
    await withEnv('JWT_KEY', 'test-secret', async () => {
      const { service, authRepo } = buildService({
        authRepo: {
          findByEmail: fn(() =>
            baseAuth({
              userId: 'user-1',
              twoFactorAuthConfig: { method: 'totp', triggerOn: ['login'] },
            })
          ),
        },
        usersRepo: { findById: fn(() => ({ status: 'INACTIVE' })) },
      })
      const result = await service.loginWithOTPCallback('jane@example.com', '123456')
      assert('needsReactivationConfirm' in (result as Record<string, unknown>))
      assertEquals(authRepo.updateAuth.calls.length, 0)
    })
  },
)

Deno.test('loginWithTOTPCallback: embeds the resolved role permissions', async () => {
  const { service, authProvider } = buildService({
    authRepo: {
      findByEmail: fn(() =>
        baseAuth({ roleIds: ['role-1'], totpSecret: { decrypt: () => 'SECRET' } })
      ),
    },
    rolesRepo: {
      findManyWithPermissions: fn(() => [{
        id: 'role-1',
        permissions: [{ id: 'p1', code: 'zanix-iam:role-read', isActive: true }],
      }]),
    },
  })
  await service.loginWithTOTPCallback('jane@example.com', '123456')
  assertEquals(
    (authProvider.totp.authenticate.calls[0]?.[2] as { permissions?: string[] }).permissions,
    ['zanix-iam:role-read'],
  )
})

const withTotpSecret = () => ({
  findByEmail: fn(() => baseAuth({ totpSecret: { decrypt: () => 'SECRET' } })),
})

Deno.test('loginWithTOTPCallback: omits accessExpiration/refreshExpiration when neither env var is configured', async () => {
  await withEnv(ACCESS_TOKEN_EXPIRATION_ENV, undefined, async () => {
    await withEnv(REFRESH_TOKEN_EXPIRATION_ENV, undefined, async () => {
      const { service, authProvider } = buildService({ authRepo: withTotpSecret() })
      await service.loginWithTOTPCallback('jane@example.com', '123456')
      const options = authProvider.totp.authenticate.calls[0]?.[2] as Record<string, unknown>
      assertEquals('accessExpiration' in options, false)
      assertEquals('refreshExpiration' in options, false)
    })
  })
})

Deno.test('loginWithTOTPCallback: passes accessExpiration when ACCESS_TOKEN_EXPIRATION is configured', async () => {
  await withEnv(ACCESS_TOKEN_EXPIRATION_ENV, '30m', async () => {
    const { service, authProvider } = buildService({ authRepo: withTotpSecret() })
    await service.loginWithTOTPCallback('jane@example.com', '123456')
    const options = authProvider.totp.authenticate.calls[0]?.[2] as Record<string, unknown>
    assertEquals(options.accessExpiration, '30m')
    assertEquals('refreshExpiration' in options, false)
  })
})

Deno.test('loginWithTOTPCallback: passes refreshExpiration when REFRESH_TOKEN_EXPIRATION is configured', async () => {
  await withEnv(REFRESH_TOKEN_EXPIRATION_ENV, '30d', async () => {
    const { service, authProvider } = buildService({ authRepo: withTotpSecret() })
    await service.loginWithTOTPCallback('jane@example.com', '123456')
    const options = authProvider.totp.authenticate.calls[0]?.[2] as Record<string, unknown>
    assertEquals(options.refreshExpiration, '30d')
    assertEquals('accessExpiration' in options, false)
  })
})

Deno.test('refreshTokens: reflects a role change made after the original login', async () => {
  const { service, rolesRepo, authProvider } = buildService({
    authRepo: {
      findById: fn(() => baseAuth({ roleIds: ['role-1'] })),
    },
    rolesRepo: {
      findManyWithPermissions: fn(() => [{
        id: 'role-1',
        permissions: [{ id: 'p1', code: 'zanix-iam:role-write', isActive: true }],
      }]),
    },
  })
  await service.refreshTokens(fakeRefreshToken('auth-1'))
  // The CURRENT role's permissions are re-resolved on every refresh now — not just at login —
  // and passed straight through as `session.refreshTokens`'s own `sessionOptions` override. A
  // role reassigned after the original login (see `RolesService.assignRole`'s own doc) is
  // reflected on the very next refresh, with no forced re-login needed.
  assertEquals(rolesRepo.findManyWithPermissions.calls[0], [['role-1']])
  assertEquals(authProvider.session.refreshTokens.calls[0]?.[1], {
    permissions: ['zanix-iam:role-write'],
  })
})

Deno.test('refreshTokens: after a role is added, the next refresh carries the union of both roles', async () => {
  const roles: Record<string, unknown> = {
    'role-web': { id: 'role-web', permissions: [{ id: 'p1', code: 'web:user', isActive: true }] },
    'role-seller': {
      id: 'role-seller',
      permissions: [{ id: 'p2', code: 'seller:manage', isActive: true }],
    },
  }
  const { service, authProvider } = buildService({
    authRepo: { findById: fn(() => baseAuth({ roleIds: ['role-web', 'role-seller'] })) },
    rolesRepo: {
      findManyWithPermissions: fn((ids: unknown) => (ids as string[]).map((id) => roles[id])),
    },
  })
  await service.refreshTokens(fakeRefreshToken('auth-1'))
  assertEquals(authProvider.session.refreshTokens.calls[0]?.[1], {
    permissions: ['web:user', 'seller:manage'],
  })
})

Deno.test('refreshTokens: with no account resolvable from the token, still asks for [] permissions (never re-resolves)', async () => {
  const { service, rolesRepo, authProvider } = buildService({
    authRepo: { findById: fn(() => undefined) },
  })
  await assertRejects(() => service.refreshTokens(fakeRefreshToken('missing-auth')), HttpError)
  assertEquals(rolesRepo.findManyWithPermissions.calls.length, 0)
  assertEquals(authProvider.session.refreshTokens.calls[0]?.[1], { permissions: [] })
})

Deno.test('refreshTokens: an undecodable token never throws before session.refreshTokens() runs its own verification', async () => {
  const { service, authProvider } = buildService()
  // A malformed, non-JWT-shaped token — `decodeRefreshSubject` must swallow the decode failure and
  // let `session.refreshTokens()` (mocked here to always "verify" successfully) run regardless,
  // never throw its own distinct error ahead of that real verification. With no decodable subject,
  // `auth` stays unresolved, so the eventual, real `FORBIDDEN` below still fires — the same error
  // shape a genuinely invalid token produces — never a raw decode-specific exception instead.
  await assertRejects(
    () => service.refreshTokens('not-a-real-jwt'),
    HttpError,
    'Refresh token verification failed',
  )
  assertEquals(authProvider.session.refreshTokens.calls[0]?.[1], { permissions: [] })
})

Deno.test('refreshTokens: falls back to the SESSION_HEADERS.user.token cookie when no explicit token is given', async () => {
  const { service, authRepo } = buildService({
    cookies: { 'X-Znx-App-Token': fakeRefreshToken('auth-1') },
  })
  await service.refreshTokens()
  assertEquals(authRepo.findById.calls[0], ['auth-1'])
})

Deno.test('loginWithPassword: throws FORBIDDEN when the linked users profile is deactivated, never reactivating (no scope creep)', async () => {
  const { service, usersRepo } = buildService({
    usersRepo: {
      assertActive: fn(() => {
        throw new HttpError('FORBIDDEN', { message: 'This account has been deactivated.' })
      }),
    },
  })
  await assertRejects(
    () => service.loginWithPassword('jane@example.com', 'secret'),
    HttpError,
    'deactivated',
  )
  // The OTP/OAuth2 reactivation carve-out (see `AuthService`'s header doc) does not apply to
  // password login: an inactive profile is a hard `assertActive` block here.
  assertEquals(usersRepo.reactivate.calls.length, 0)
})

Deno.test('loginWithTOTPCallback: throws FORBIDDEN when the linked users profile is deactivated, never reactivating (no scope creep)', async () => {
  const { service, usersRepo } = buildService({
    authRepo: withTotpSecret(),
    usersRepo: {
      assertActive: fn(() => {
        throw new HttpError('FORBIDDEN', { message: 'This account has been deactivated.' })
      }),
    },
  })
  await assertRejects(
    () => service.loginWithTOTPCallback('jane@example.com', '123456'),
    HttpError,
    'deactivated',
  )
  assertEquals(usersRepo.reactivate.calls.length, 0)
})

Deno.test('totpEnroll: throws UNAUTHORIZED with no session', async () => {
  const { service } = buildService({ session: {} })
  await assertRejects(() => service.totpEnroll(), HttpError, 'Authentication required')
})

Deno.test('totpEnroll: returns a secret and provisioning URI, persisting nothing', async () => {
  const { service, authRepo } = buildService()
  const result = await service.totpEnroll()
  assertEquals(result.secret, 'SECRET')
  assertEquals(result.uri, 'otpauth://totp/...')
  assertEquals(authRepo.updateAuth.calls.length, 0)
})

/** The provisioning label is built from the account's email, looked up with
 * `AuthRepository.findById(subject)`, never from `subject` itself (the JWT `sub`, an internal id):
 * `totpProvisioningLabel`'s default is the identity function `(email) => email`, so whatever it
 * receives is what the authenticator app shows. */
Deno.test("totpEnroll: resolves the account's real email (never the raw subject id) for the provisioning label", async () => {
  const { service, authRepo, authProvider } = buildService({
    authRepo: { findById: fn(() => baseAuth({ id: 'auth-1' })) },
  })
  await service.totpEnroll()
  const label = authProvider.totp.getProvisioningUri.calls[0]?.[1]
  assertEquals(label, 'jane@example.com')
  assertEquals(authRepo.findById.calls[0]?.[0], 'auth-1')
})

Deno.test(
  'totpEnroll: falls back to the raw subject id when the account lookup finds nothing',
  async () => {
    const { service, authProvider } = buildService({
      authRepo: { findById: fn(() => undefined) },
    })
    await service.totpEnroll()
    const label = authProvider.totp.getProvisioningUri.calls[0]?.[1]
    assertEquals(label, 'auth-1')
  },
)

Deno.test('totpConfirm: throws FORBIDDEN when the code does not verify', async () => {
  const { service, authRepo } = buildService({
    authProvider: { totp: { ...defaultAuthProvider().totp, verify: fn(() => false) } },
  })
  await assertRejects(() => service.totpConfirm('SECRET', '000000'), HttpError, 'Invalid TOTP code')
  assertEquals(authRepo.updateAuth.calls.length, 0)
})

Deno.test('totpConfirm: on success persists the secret and sends the totp-enabled notification', async () => {
  await withEnv('TEMPLATES_BACKEND', 'local', async () => {
    const { service, authRepo, notifier } = buildService()
    const result = await service.totpConfirm('SECRET', '123456')
    assertEquals(result, { response: 'TOTP enabled' })
    const update = authRepo.updateAuth.calls[0]?.[0] as Record<string, unknown>
    assertEquals(update.totpSecret, 'SECRET')
    assertEquals((update.twoFactorAuthConfig as { method: string }).method, 'totp')
    assertEquals(notifier.email.calls.length, 1)
    assertEquals((notifier.email.calls[0]?.[0] as { to: string }).to, 'jane@example.com')
  })
})

Deno.test('totpConfirm: without TEMPLATES_BACKEND=local the secret is persisted and no database-only notice is sent', async () => {
  await withEnv('TEMPLATES_BACKEND', undefined, async () => {
    const { service, authRepo, notifier } = buildService()
    assertEquals(await service.totpConfirm('SECRET', '123456'), { response: 'TOTP enabled' })
    assertEquals(authRepo.updateAuth.calls.length, 1)
    assertEquals(notifier.email.calls.length, 0)
  })
})

Deno.test('disableTotp: throws UNAUTHORIZED with no session', async () => {
  const { service } = buildService({ session: {} })
  await assertRejects(() => service.disableTotp(), HttpError, 'Authentication required')
})

Deno.test('disableTotp: throws FORBIDDEN when the session subject no longer resolves', async () => {
  const { service } = buildService({ authRepo: { findById: fn(() => undefined) } })
  await assertRejects(() => service.disableTotp(), HttpError, 'Account not found')
})

Deno.test('disableTotp: clears totpSecret/twoFactorAuthConfig when TOTP is the configured method', async () => {
  const { service, authRepo } = buildService({
    authRepo: {
      findById: fn(() =>
        baseAuth({ twoFactorAuthConfig: { method: 'totp', triggerOn: ['login'] } })
      ),
    },
  })
  const result = await service.disableTotp()
  assertEquals(result, { response: 'TOTP disabled' })
  assertEquals(authRepo.updateAuth.calls[0], [
    { id: 'auth-1' },
    { unset: ['totpSecret', 'twoFactorAuthConfig'] },
  ])
})

Deno.test('disableTotp: not the configured method is a no-op write', async () => {
  const { service, authRepo } = buildService()
  const result = await service.disableTotp()
  assertEquals(result, { response: 'TOTP disabled' })
  assertEquals(authRepo.updateAuth.calls.length, 0)
})

Deno.test('disableTotp: a different (OTP) 2FA method is never cleared', async () => {
  const { service, authRepo } = buildService({
    authRepo: {
      findById: fn(() =>
        baseAuth({ twoFactorAuthConfig: { method: 'email', triggerOn: ['login'] } })
      ),
    },
  })
  const result = await service.disableTotp()
  assertEquals(result, { response: 'TOTP disabled' })
  assertEquals(authRepo.updateAuth.calls.length, 0)
})

Deno.test('phoneEnroll: throws UNAUTHORIZED with no session', async () => {
  const { service } = buildService({ session: {} })
  await assertRejects(
    () => service.phoneEnroll('+15551234567'),
    HttpError,
    'Authentication required',
  )
})

Deno.test('phoneEnroll: generates an OTP against a namespaced target and sends it via sms', async () => {
  const { service, authProvider, notifier } = buildService()
  const result = await service.phoneEnroll('+15551234567')
  assertEquals(result, { response: 'notification sent' })
  assertEquals(authProvider.otp.generate.calls[0]?.[0], { target: 'phone-enroll:auth-1', exp: 300 })
  const [channel, message] = notifier.sendMessage.calls[0] as [
    string,
    { zanixTemplate: string; to: string; data: { code: string; ttl: number } },
  ]
  assertEquals(channel, 'sms')
  assertEquals(message.to, '+15551234567')
  assertEquals(message.zanixTemplate, 'otp')
  assertEquals(message.data, { code: '123456', ttl: 5 })
})

Deno.test('phoneConfirm: throws UNAUTHORIZED with no session', async () => {
  const { service } = buildService({ session: {} })
  await assertRejects(
    () => service.phoneConfirm('+15551234567', '123456'),
    HttpError,
    'Authentication required',
  )
})

Deno.test('phoneConfirm: throws FORBIDDEN when the code does not verify — never persists phone', async () => {
  const { service, authRepo, authProvider } = buildService({
    authProvider: { otp: { ...defaultAuthProvider().otp, verify: fn(() => false) } },
  })
  await assertRejects(
    () => service.phoneConfirm('+15551234567', 'wrong'),
    HttpError,
    'Invalid or expired code',
  )
  assertEquals(authRepo.updateAuth.calls.length, 0)
  assertEquals(authProvider.otp.verify.calls[0], ['phone-enroll:auth-1', 'wrong'])
})

Deno.test('phoneConfirm: a verified code persists phone, never otpNotifier', async () => {
  const { service, authRepo } = buildService()
  const result = await service.phoneConfirm('+15551234567', '123456')
  assertEquals(result, { response: 'Phone verified' })
  assertEquals(authRepo.updateAuth.calls[0], [
    { id: 'auth-1', phone: '+15551234567' },
    { applyProtection: true },
  ])
})

Deno.test('disablePhone: throws UNAUTHORIZED with no session', async () => {
  const { service } = buildService({ session: {} })
  await assertRejects(() => service.disablePhone(), HttpError, 'Authentication required')
})

Deno.test('disablePhone: throws FORBIDDEN when the session subject no longer resolves', async () => {
  const { service } = buildService({ authRepo: { findById: fn(() => undefined) } })
  await assertRejects(() => service.disablePhone(), HttpError, 'Account not found')
})

Deno.test('disablePhone: clears phone and otpNotifier together, unconditionally', async () => {
  const { service, authRepo } = buildService({
    authRepo: {
      findById: fn(() => baseAuth({ phone: { unmask: () => '+15551234567' }, otpNotifier: 'sms' })),
    },
  })
  const result = await service.disablePhone()
  assertEquals(result, { response: 'Phone removed' })
  assertEquals(authRepo.updateAuth.calls[0], [
    { id: 'auth-1' },
    { unset: ['phone', 'otpNotifier'] },
  ])
})

Deno.test('setOtpNotifier: throws UNAUTHORIZED with no session', async () => {
  const { service } = buildService({ session: {} })
  await assertRejects(() => service.setOtpNotifier('sms'), HttpError, 'Authentication required')
})

Deno.test('setOtpNotifier: throws BAD_REQUEST for sms/whatsapp with no verified phone on file', async () => {
  const { service } = buildService({
    authRepo: { findById: fn(() => baseAuth({ phone: undefined })) },
  })
  await assertRejects(
    () => service.setOtpNotifier('sms'),
    HttpError,
    'Verify a phone number',
  )
})

Deno.test('setOtpNotifier: sets sms/whatsapp once a phone is already verified', async () => {
  const { service, authRepo } = buildService({
    authRepo: { findById: fn(() => baseAuth({ phone: { unmask: () => '+15551234567' } })) },
  })
  const result = await service.setOtpNotifier('whatsapp')
  assertEquals(result, { response: 'OTP delivery preference updated' })
  assertEquals(authRepo.updateAuth.calls[0], [{ id: 'auth-1', otpNotifier: 'whatsapp' }])
})

Deno.test('setOtpNotifier: omitted notifier resets back to email, even with a phone on file', async () => {
  const { service, authRepo } = buildService({
    authRepo: {
      findById: fn(() => baseAuth({ phone: { unmask: () => '+15551234567' }, otpNotifier: 'sms' })),
    },
  })
  const result = await service.setOtpNotifier()
  assertEquals(result, { response: 'OTP delivery preference updated' })
  assertEquals(authRepo.updateAuth.calls[0], [{ id: 'auth-1' }, { unset: ['otpNotifier'] }])
})

Deno.test(
  "setOtpNotifier: '' (a plain <select>'s own \"Email\" option value) resets back to email, " +
    'exactly like omitted — never rejected as an invalid notifier',
  async () => {
    const { service, authRepo } = buildService({
      authRepo: {
        findById: fn(() =>
          baseAuth({ phone: { unmask: () => '+15551234567' }, otpNotifier: 'sms' })
        ),
      },
    })
    const result = await service.setOtpNotifier('')
    assertEquals(result, { response: 'OTP delivery preference updated' })
    assertEquals(authRepo.updateAuth.calls[0], [{ id: 'auth-1' }, { unset: ['otpNotifier'] }])
  },
)

Deno.test('loginWithOauth: throws BAD_REQUEST when the provider is not configured', () => {
  const { service } = buildService()
  let threw = false
  try {
    service.loginWithOauth('google')
  } catch (error) {
    threw = error instanceof HttpError
  }
  // `google`/`github` resource instances only populate `resolveResource`'s process-wide overlay
  // once `activateApps()`/`installApp()` actually resolves them at real app-activation time —
  // never in this isolated unit test, so this is always the "not configured" branch, exercising
  // it deliberately.
  assertEquals(threw, true)
})

Deno.test('loginWithOauth: forwards an explicit state into generateAuthUrl', () => {
  const { service } = buildService()
  const generateAuthUrl = fn((..._args: unknown[]) => ({
    url: 'https://provider/auth',
    state: 'x',
  }))
  // `getOauthConnector` resolves through `resolveResource` (a process-wide overlay only a real
  // `activateApps()` populates — see the "not configured" test above) — shadowed here the same
  // way `providers`/`interactors`/`context` are, so `loginWithOauth`'s own forwarding behavior can
  // be exercised without standing up a real app.
  mockAccessor(service, 'getOauthConnector', fn(() => ({ generateAuthUrl })))

  service.loginWithOauth('google', 'caller-supplied-state')

  assertEquals(generateAuthUrl.calls[0], [{ state: 'caller-supplied-state', loginHint: undefined }])
})

Deno.test('loginWithOauth: forwards undefined when called with no state', () => {
  const { service } = buildService()
  const generateAuthUrl = fn((..._args: unknown[]) => ({
    url: 'https://provider/auth',
    state: 'x',
  }))
  mockAccessor(service, 'getOauthConnector', fn(() => ({ generateAuthUrl })))

  service.loginWithOauth('google')

  assertEquals(generateAuthUrl.calls[0], [{ state: undefined, loginHint: undefined }])
})

Deno.test('loginWithOauth: forwards loginHint into generateAuthUrl', () => {
  const { service } = buildService()
  const generateAuthUrl = fn((..._args: unknown[]) => ({
    url: 'https://provider/auth',
    state: 'x',
  }))
  mockAccessor(service, 'getOauthConnector', fn(() => ({ generateAuthUrl })))

  service.loginWithOauth('google', 'caller-supplied-state', 'jane@example.com')

  assertEquals(generateAuthUrl.calls[0], [
    { state: 'caller-supplied-state', loginHint: 'jane@example.com' },
  ])
})

function withOauthConnector(service: AuthService, validateCode: (...args: unknown[]) => unknown) {
  // Same seam `loginWithOauth`'s own tests already shadow — `getOauthConnector` resolves through
  // `resolveResource`, a process-wide overlay only a real `activateApps()` populates.
  mockAccessor(service, 'getOauthConnector', fn(() => ({ validateCode: fn(validateCode) })))
}

Deno.test('loginWithOauthCallback: throws BAD_REQUEST when the provider is not configured', async () => {
  const { service } = buildService()
  // No `getOauthConnector` override — same "unconfigured outside a real app" default as
  // `loginWithOauth`'s own "not configured" test above.
  await assertRejects(
    () => service.loginWithOauthCallback('code', 'google'),
    HttpError,
    'not configured',
  )
})

Deno.test('loginWithOauthCallback: throws FORBIDDEN when the provider returns no email at all', async () => {
  const { service } = buildService()
  withOauthConnector(service, () => ({ email: null }))
  await assertRejects(
    () => service.loginWithOauthCallback('code', 'github'),
    HttpError,
    'no verified email',
  )
})

Deno.test('loginWithOauthCallback: throws FORBIDDEN when Google reports the email as unverified', async () => {
  const { service } = buildService()
  withOauthConnector(service, () => ({ email: 'jane@example.com', verified_email: false }))
  await assertRejects(
    () => service.loginWithOauthCallback('code', 'google'),
    HttpError,
    'no verified email',
  )
})

Deno.test('loginWithOauthCallback: no existing account self-provisions a new profile+auth and sends the welcome email', async () => {
  // Unset on the FIRST lookup (no account yet), then re-fetched as the just-created record on the
  // SECOND (see `loginWithOauthCallback`'s own doc for why it re-fetches through `findByEmail`
  // rather than trusting the just-created document directly).
  let lookups = 0
  const { service, authRepo, usersRepo, notifier } = buildService({
    authRepo: {
      findByEmail: fn((..._args: unknown[]): unknown =>
        lookups++ === 0 ? undefined : baseAuth({ userId: 'user-1' })
      ),
      registerAuth: fn((..._args: unknown[]) => ({})),
    },
  })
  withOauthConnector(service, () => ({ email: 'new@example.com', verified_email: true }))

  const result = await service.loginWithOauthCallback('code', 'google') as Record<string, unknown>

  assertEquals(usersRepo.registerUser.calls[0], [{}])
  const registered = authRepo.registerAuth.calls[0]?.[0] as Record<string, unknown>
  assertEquals(registered.email, 'new@example.com')
  assertEquals(registered.oauthProvider, 'google')
  assertEquals(registered.userId, 'user-1')
  assertEquals(notifier.email.calls[0]?.[0], {
    to: 'new@example.com',
    subject: 'Welcome to zanix-iam',
    zanixTemplate: 'welcome',
    data: {},
  })
  // Re-fetched through the same `findByEmail` hydration path, then logged in for real.
  assertEquals(authRepo.findByEmail.calls.length, 2)
  assertEquals(result.accessToken, 'access')
})

Deno.test("loginWithOauthCallback: self-provisioning assigns auth.app.ts's configured defaultRoleId — symmetric with loginWithOTPCallback's own identical resolution", async () => {
  setConfigOverride('auth', 'defaultRoleId', 'role-default-member')
  try {
    let lookups = 0
    const { service, authRepo } = buildService({
      authRepo: {
        findByEmail: fn((..._args: unknown[]): unknown =>
          lookups++ === 0 ? undefined : baseAuth({ userId: 'user-1' })
        ),
        registerAuth: fn((..._args: unknown[]) => ({})),
      },
    })
    withOauthConnector(service, () => ({ email: 'new@example.com', verified_email: true }))

    await service.loginWithOauthCallback('code', 'google')

    const registered = authRepo.registerAuth.calls[0]?.[0] as Record<string, unknown>
    assertEquals(registered.roleIds, ['role-default-member'])
  } finally {
    setConfigOverride('auth', 'defaultRoleId', '')
  }
})

Deno.test('loginWithOauthCallback: an email already linked to a DIFFERENT sign-in method is a CONFLICT, never auto-linked', async () => {
  const { service, authRepo } = buildService({
    authRepo: { findByEmail: fn(() => baseAuth({ oauthProvider: 'github' })) },
  })
  withOauthConnector(service, () => ({ email: 'jane@example.com', verified_email: true }))

  await assertRejects(
    () => service.loginWithOauthCallback('code', 'google'),
    HttpError,
    'different sign-in method',
  )
  assertEquals(authRepo.registerAuth.calls.length, 0)
})

Deno.test('loginWithOauthCallback: an existing ACTIVE account already linked to the SAME provider just logs in, no reactivation', async () => {
  const { service, authRepo, usersRepo } = buildService({
    authRepo: { findByEmail: fn(() => baseAuth({ oauthProvider: 'google', userId: 'user-1' })) },
  })
  withOauthConnector(service, () => ({ email: 'jane@example.com', verified_email: true }))

  const result = await service.loginWithOauthCallback('code', 'google') as Record<string, unknown>

  assertEquals(usersRepo.findById.calls[0], ['user-1'])
  assertEquals(usersRepo.reactivate.calls.length, 0)
  assertEquals(authRepo.registerAuth.calls.length, 0)
  assertEquals(result.accessToken, 'access')
})

Deno.test(
  'loginWithOauthCallback: an INACTIVE account returns a reactivation challenge instead of ' +
    'reactivating or finishing login',
  async () => {
    await withEnv('JWT_KEY', 'test-secret', async () => {
      const { service, usersRepo } = buildService({
        authRepo: {
          findByEmail: fn(() =>
            baseAuth({ id: 'auth-1', oauthProvider: 'google', userId: 'user-1' })
          ),
        },
        usersRepo: { findById: fn(() => ({ status: 'INACTIVE' })) },
      })
      withOauthConnector(service, () => ({ email: 'jane@example.com', verified_email: true }))

      const result = await service.loginWithOauthCallback('code', 'google')

      assert('needsReactivationConfirm' in result && result.needsReactivationConfirm === true)
      assert(typeof (result as { reactivationToken: string }).reactivationToken === 'string')
      assertEquals(usersRepo.reactivate.calls.length, 0)
    })
  },
)

Deno.test('loginWithOauthCallback: still hard-blocks a DELETED account with the unchanged error, never reactivating', async () => {
  const { service, usersRepo } = buildService({
    authRepo: { findByEmail: fn(() => baseAuth({ oauthProvider: 'google', userId: 'user-1' })) },
    usersRepo: { findById: fn(() => ({ status: 'DELETED' })) },
  })
  withOauthConnector(service, () => ({ email: 'jane@example.com', verified_email: true }))

  await assertRejects(
    () => service.loginWithOauthCallback('code', 'google'),
    HttpError,
    'no longer exists',
  )
  assertEquals(usersRepo.reactivate.calls.length, 0)
})

Deno.test('refreshTokens: throws FORBIDDEN when no account is found for the token subject', async () => {
  const { service } = buildService({ authRepo: { findById: fn(() => undefined) } })
  await assertRejects(() => service.refreshTokens(fakeRefreshToken('missing-auth')), HttpError)
})

Deno.test('refreshTokens: on success records lastLoginAt and returns fresh tokens, with no leaked payload', async () => {
  const { service, authRepo } = buildService()
  const result = await service.refreshTokens(fakeRefreshToken('auth-1')) as Record<string, unknown>
  assertEquals(result.accessToken, 'new-access')
  const update = authRepo.updateAuth.calls[0]?.[0] as Record<string, unknown>
  assert(update.lastLoginAt instanceof Date)
  // The issued tokens are never mirrored into this project's own storage — see
  // `AuthService.refreshTokens`'s own doc for why a separate, locally stored token hash was
  // removed.
  assertEquals('systemRefreshToken' in update, false)
  // The verified token's own decoded `payload` (`{ sub: 'auth-1' }`, per `session.refreshTokens`'s
  // own mock) must never leak into the client-facing response.
  assertEquals('payload' in result, false)
})

Deno.test('refreshTokens: throws FORBIDDEN when the linked users profile is deleted', async () => {
  const { service } = buildService({
    usersRepo: {
      assertActive: fn(() => {
        throw new HttpError('FORBIDDEN', { message: 'This account no longer exists.' })
      }),
    },
  })
  await assertRejects(
    () => service.refreshTokens(fakeRefreshToken('auth-1')),
    HttpError,
    'no longer exists',
  )
})

Deno.test('refreshTokens: two near-simultaneous requests presenting the SAME original token both succeed', async () => {
  // Covers the rotation-grace window `@zanix/auth` provides
  // (`getRotationGraceTokens`/`setRotationGraceTokens` in that package's own
  // `utils/sessions/block-list.ts`/`refresh.ts`) — a browser prefetching a link on hover then
  // navigating it, a double click, or two tabs on one session can all legitimately present the
  // exact same still-valid refresh token twice in quick succession. `@zanix/auth`'s own
  // `session.refreshTokens()` is mocked here (the same seam every other test in this file mocks
  // it at) to simulate that real behavior: BOTH calls resolve successfully, the second one
  // handing back the pair already issued to the first, rather than throwing. This test's whole
  // point is proving `AuthService.refreshTokens` itself never re-introduces a stricter, zero
  // tolerance gate on top of that (its own former `systemRefreshToken` exact-match check did
  // exactly this, and was removed for it — see that method's own doc).
  const firstPairTokens = { accessToken: 'access-1', refreshToken: 'refresh-1' }
  const refreshTokens = fn((..._args: unknown[]) => ({
    oldToken: 'old',
    payload: { sub: 'auth-1' },
    ...firstPairTokens,
  }))
  const { service } = buildService({
    authProvider: { session: { ...defaultAuthProvider().session, refreshTokens } },
  })

  const token = fakeRefreshToken('auth-1')
  const [first, second] = await Promise.all([
    service.refreshTokens(token),
    service.refreshTokens(token),
  ]) as [Record<string, unknown>, Record<string, unknown>]

  assertEquals(first.accessToken, 'access-1')
  assertEquals(second.accessToken, 'access-1')
  assertEquals(refreshTokens.calls.length, 2)
})

Deno.test('revokeToken: revokes the session token via @zanix/auth, no separate local token to clear', async () => {
  const { service, authProvider, authRepo } = buildService({ session: { subject: 'auth-1' } })
  const result = await service.revokeToken('token-1')
  assertEquals(result, { response: 'token revoked' })
  assertEquals(authProvider.session.revokeToken.calls[0], ['token-1'])
  // No `AuthRepository` write of any kind on revoke anymore — the only state a refresh token
  // ever lives in is `@zanix/auth`'s own JWT + blocklist mechanism.
  assertEquals(authRepo.updateAuth.calls.length, 0)
})

Deno.test('issueSessionForSubject: mints tokens directly, with no 2FA branch of any kind', async () => {
  const { service, authProvider, authRepo } = buildService({
    authRepo: {
      findById: fn(() =>
        baseAuth({ id: 'auth-1', twoFactorAuthConfig: { method: 'totp', triggerOn: ['login'] } })
      ),
    },
  })
  const result = await service.issueSessionForSubject('auth-1') as Record<string, unknown>
  assertEquals(result.accessToken, 'access')
  assertEquals(authProvider.session.generateTokens.calls[0][0], {
    subject: 'auth-1',
    permissions: [],
  })
  assert(authRepo.updateAuth.calls.length === 1)
  const update = authRepo.updateAuth.calls[0]?.[0] as Record<string, unknown>
  assert(update.lastLoginAt instanceof Date)
})

Deno.test('issueSessionForSubject: throws FORBIDDEN when no auth record exists for the subject', async () => {
  const { service } = buildService({
    authRepo: { findById: fn(() => undefined) },
  })
  await assertRejects(
    () => service.issueSessionForSubject('missing'),
    HttpError,
    'Account not found.',
  )
})

Deno.test('issueSessionForSubject: throws when the linked users profile is deactivated/deleted', async () => {
  const { service } = buildService({
    authRepo: { findById: fn(() => baseAuth({ id: 'auth-1' })) },
    usersRepo: {
      assertActive: fn(() => {
        throw new HttpError('FORBIDDEN', { message: 'This account no longer exists.' })
      }),
    },
  })
  await assertRejects(
    () => service.issueSessionForSubject('auth-1'),
    HttpError,
    'no longer exists',
  )
})

Deno.test('getOwnAuthMethods: throws UNAUTHORIZED with no session', async () => {
  const { service } = buildService({ session: {} })
  await assertRejects(() => service.getOwnAuthMethods(), HttpError, 'Authentication required')
})

Deno.test('getOwnAuthMethods: throws FORBIDDEN when the session subject no longer resolves', async () => {
  const { service } = buildService({ authRepo: { findById: fn(() => undefined) } })
  await assertRejects(() => service.getOwnAuthMethods(), HttpError, 'Account not found')
})

Deno.test('getOwnAuthMethods: returns a plain sanitized summary, never the raw password/totpSecret', async () => {
  const { service } = buildService({
    authRepo: {
      findById: fn(() =>
        baseAuth({
          oauthProvider: 'google',
          twoFactorAuthConfig: { method: 'totp', triggerOn: ['login'] },
        })
      ),
    },
  })
  const result = await service.getOwnAuthMethods()
  assertEquals(result, {
    email: 'jane@example.com',
    hasPassword: true,
    oauthProvider: 'google',
    totpEnabled: true,
    phone: null,
    otpNotifier: null,
  })
})

Deno.test('getOwnAuthMethods: no password/oauth/totp reports the falsy shape', async () => {
  const { service } = buildService({
    authRepo: { findById: fn(() => baseAuth({ password: undefined })) },
  })
  const result = await service.getOwnAuthMethods()
  assertEquals(result, {
    email: 'jane@example.com',
    hasPassword: false,
    oauthProvider: null,
    totpEnabled: false,
    phone: null,
    otpNotifier: null,
  })
})

Deno.test('resolveLoginMethods: an email with a password configured reports hasPassword true', async () => {
  const { service } = buildService({
    authRepo: { findByEmail: fn(() => baseAuth({ password: { verify: () => true } })) },
  })
  const result = await service.resolveLoginMethods('jane@example.com')
  assertEquals(result, {
    hasPassword: true,
    oauthProviders: [],
    otpNotifier: null,
    hasVerifiedPhone: false,
  })
})

Deno.test('resolveLoginMethods: an email with an OAuth2 provider linked reports it', async () => {
  const { service } = buildService({
    authRepo: {
      findByEmail: fn(() => baseAuth({ password: undefined, oauthProvider: 'google' })),
    },
  })
  const result = await service.resolveLoginMethods('jane@example.com')
  assertEquals(result, {
    hasPassword: false,
    oauthProviders: ['google'],
    otpNotifier: null,
    hasVerifiedPhone: false,
  })
})

Deno.test('resolveLoginMethods: an existing email with no password/OAuth2 method falls back to the safe default', async () => {
  const { service } = buildService({
    authRepo: { findByEmail: fn(() => baseAuth({ password: undefined })) },
  })
  const result = await service.resolveLoginMethods('jane@example.com')
  assertEquals(result, {
    hasPassword: false,
    oauthProviders: [],
    otpNotifier: null,
    hasVerifiedPhone: false,
  })
})

Deno.test('resolveLoginMethods: a NONEXISTENT email returns the IDENTICAL default — never reveals the email does not exist', async () => {
  // The real security property this method exists for: a caller must not be able to tell an
  // unregistered email apart from a registered one with no password/OAuth2 method configured —
  // see `AuthService.resolveLoginMethods`'s own doc for the full email-enumeration rationale.
  const noAccount = buildService({ authRepo: { findByEmail: fn(() => undefined) } })
  const noPasswordAccount = buildService({
    authRepo: { findByEmail: fn(() => baseAuth({ password: undefined })) },
  })

  const resultForMissingEmail = await noAccount.service.resolveLoginMethods('nobody@example.com')
  const resultForNoPassword = await noPasswordAccount.service.resolveLoginMethods(
    'jane@example.com',
  )

  assertEquals(resultForMissingEmail, {
    hasPassword: false,
    oauthProviders: [],
    otpNotifier: null,
    hasVerifiedPhone: false,
  })
  assertEquals(resultForMissingEmail, resultForNoPassword)
})

Deno.test('resolveLoginMethods: never throws for a nonexistent email', async () => {
  const { service } = buildService({ authRepo: { findByEmail: fn(() => undefined) } })
  // No `assertRejects` here on purpose — the whole point is this call resolves normally.
  const result = await service.resolveLoginMethods('nobody@example.com')
  assertEquals(result, {
    hasPassword: false,
    oauthProviders: [],
    otpNotifier: null,
    hasVerifiedPhone: false,
  })
})

Deno.test(
  "resolveLoginMethods: reports the account's own configured otpNotifier and a verified phone",
  async () => {
    const { service } = buildService({
      authRepo: {
        findByEmail: fn(() => baseAuth({ otpNotifier: 'whatsapp', phone: { unmask: () => '+1' } })),
      },
    })
    const result = await service.resolveLoginMethods('jane@example.com')
    assertEquals(result.otpNotifier, 'whatsapp')
    assertEquals(result.hasVerifiedPhone, true)
  },
)

Deno.test(
  'resolveLoginMethods: no configured otpNotifier reports null (the real "email" default), never the literal string',
  async () => {
    const { service } = buildService({
      authRepo: { findByEmail: fn(() => baseAuth({ phone: { unmask: () => '+1' } })) },
    })
    const result = await service.resolveLoginMethods('jane@example.com')
    assertEquals(result.otpNotifier, null)
    // A verified phone alone (no explicit otpNotifier override) still reports true here — the two
    // fields are independent: one says WHICH channel is CURRENT, the other says whether an
    // alternate is even deliverable at all.
    assertEquals(result.hasVerifiedPhone, true)
  },
)

Deno.test('linkOauth: throws UNAUTHORIZED with no session', async () => {
  const { service } = buildService({ session: {} })
  await assertRejects(
    () => service.linkOauth('code', 'google'),
    HttpError,
    'Authentication required',
  )
})

Deno.test('linkOauth: throws BAD_REQUEST when the provider is not configured', async () => {
  const { service } = buildService()
  await assertRejects(() => service.linkOauth('code', 'google'), HttpError, 'not configured')
})

Deno.test('linkOauth: throws FORBIDDEN when the provider returns no verified email', async () => {
  const { service } = buildService()
  withOauthConnector(service, () => ({ email: 'jane@example.com', verified_email: false }))
  await assertRejects(
    () => service.linkOauth('code', 'google'),
    HttpError,
    'no verified email',
  )
})

Deno.test("linkOauth: throws CONFLICT when the provider's email differs from the caller's own", async () => {
  const { service } = buildService()
  withOauthConnector(service, () => ({ email: 'different@example.com', verified_email: true }))
  await assertRejects(
    () => service.linkOauth('code', 'google'),
    HttpError,
    "doesn't match",
  )
})

Deno.test("linkOauth: matching email connects the provider to the caller's own account", async () => {
  const { service, authRepo } = buildService()
  withOauthConnector(service, () => ({ email: 'jane@example.com', verified_email: true }))
  const result = await service.linkOauth('code', 'google')
  assertEquals(result, { response: 'google connected' })
  assertEquals(authRepo.updateAuth.calls[0], [{ id: 'auth-1', oauthProvider: 'google' }])
})

Deno.test('unlinkOauth: throws UNAUTHORIZED with no session', async () => {
  const { service } = buildService({ session: {} })
  await assertRejects(() => service.unlinkOauth('google'), HttpError, 'Authentication required')
})

Deno.test('unlinkOauth: throws FORBIDDEN when the session subject no longer resolves', async () => {
  const { service } = buildService({ authRepo: { findById: fn(() => undefined) } })
  await assertRejects(() => service.unlinkOauth('google'), HttpError, 'Account not found')
})

Deno.test('unlinkOauth: clears oauthProvider/oauthRefreshToken when connected to that provider', async () => {
  const { service, authRepo } = buildService({
    authRepo: { findById: fn(() => baseAuth({ oauthProvider: 'google' })) },
  })
  const result = await service.unlinkOauth('google')
  assertEquals(result, { response: 'google disconnected' })
  assertEquals(authRepo.updateAuth.calls[0], [
    { id: 'auth-1' },
    { unset: ['oauthProvider', 'oauthRefreshToken'] },
  ])
})

Deno.test('unlinkOauth: connected to a DIFFERENT provider is a no-op write', async () => {
  const { service, authRepo } = buildService({
    authRepo: { findById: fn(() => baseAuth({ oauthProvider: 'github' })) },
  })
  const result = await service.unlinkOauth('google')
  assertEquals(result, { response: 'google disconnected' })
  assertEquals(authRepo.updateAuth.calls.length, 0)
})

Deno.test(
  'confirmReactivation: a valid token reactivates the INACTIVE account and finishes login',
  async () => {
    await withEnv('JWT_KEY', 'test-secret', async () => {
      const { service, usersRepo } = buildService({
        authRepo: { findById: fn(() => baseAuth({ id: 'auth-1', userId: 'user-1' })) },
        usersRepo: { findById: fn(() => ({ status: 'INACTIVE' })) },
      })
      const token = await createJWT(
        { sub: 'auth-1', purpose: REACTIVATION_TOKEN_PURPOSE },
        'test-secret',
        { expiration: '5m' },
      )

      const result = await service.confirmReactivation(token) as Record<string, unknown>

      assertEquals(usersRepo.reactivate.calls[0], ['user-1'])
      assertEquals(result.accessToken, 'access')
    })
  },
)

Deno.test(
  'confirmReactivation: an already-ACTIVE account (reactivated by a second, earlier confirm) ' +
    'still finishes login without a redundant reactivate write',
  async () => {
    await withEnv('JWT_KEY', 'test-secret', async () => {
      const { service, usersRepo } = buildService({
        authRepo: { findById: fn(() => baseAuth({ id: 'auth-1', userId: 'user-1' })) },
        usersRepo: { findById: fn(() => ({ status: 'ACTIVE' })) },
      })
      const token = await createJWT(
        { sub: 'auth-1', purpose: REACTIVATION_TOKEN_PURPOSE },
        'test-secret',
        { expiration: '5m' },
      )

      const result = await service.confirmReactivation(token) as Record<string, unknown>

      assertEquals(usersRepo.reactivate.calls.length, 0)
      assertEquals(result.accessToken, 'access')
    })
  },
)

Deno.test('confirmReactivation: a DELETED account still hard-blocks, never reactivating', async () => {
  await withEnv('JWT_KEY', 'test-secret', async () => {
    const { service, usersRepo } = buildService({
      authRepo: { findById: fn(() => baseAuth({ id: 'auth-1', userId: 'user-1' })) },
      usersRepo: { findById: fn(() => ({ status: 'DELETED' })) },
    })
    const token = await createJWT(
      { sub: 'auth-1', purpose: REACTIVATION_TOKEN_PURPOSE },
      'test-secret',
      { expiration: '5m' },
    )

    await assertRejects(() => service.confirmReactivation(token), HttpError, 'no longer exists')
    assertEquals(usersRepo.reactivate.calls.length, 0)
  })
})

Deno.test('confirmReactivation: a garbage/malformed token is rejected, never reactivating', async () => {
  await withEnv('JWT_KEY', 'test-secret', async () => {
    const { service, usersRepo } = buildService({
      usersRepo: { findById: fn(() => ({ status: 'INACTIVE' })) },
    })
    await assertRejects(
      () => service.confirmReactivation('not-a-real-token'),
      HttpError,
      'invalid or has expired',
    )
    assertEquals(usersRepo.reactivate.calls.length, 0)
  })
})

Deno.test('confirmReactivation: an expired token is rejected, never reactivating', async () => {
  await withEnv('JWT_KEY', 'test-secret', async () => {
    const { service, usersRepo } = buildService({
      authRepo: { findById: fn(() => baseAuth({ id: 'auth-1', userId: 'user-1' })) },
      usersRepo: { findById: fn(() => ({ status: 'INACTIVE' })) },
    })
    const token = await createJWT(
      {
        sub: 'auth-1',
        purpose: REACTIVATION_TOKEN_PURPOSE,
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      'test-secret',
    )

    await assertRejects(
      () => service.confirmReactivation(token),
      HttpError,
      'invalid or has expired',
    )
    assertEquals(usersRepo.reactivate.calls.length, 0)
  })
})

Deno.test(
  'confirmReactivation: a token minted for a DIFFERENT purpose is rejected, never reactivating',
  async () => {
    await withEnv('JWT_KEY', 'test-secret', async () => {
      const { service, usersRepo } = buildService({
        authRepo: { findById: fn(() => baseAuth({ id: 'auth-1', userId: 'user-1' })) },
        usersRepo: { findById: fn(() => ({ status: 'INACTIVE' })) },
      })
      const token = await createJWT(
        { sub: 'auth-1', purpose: 'something-else' },
        'test-secret',
        { expiration: '5m' },
      )

      await assertRejects(
        () => service.confirmReactivation(token),
        HttpError,
        'invalid or has expired',
      )
      assertEquals(usersRepo.reactivate.calls.length, 0)
    })
  },
)

Deno.test(
  'confirmReactivation: a token signed with the WRONG secret is rejected, never reactivating',
  async () => {
    await withEnv('JWT_KEY', 'test-secret', async () => {
      const { service, usersRepo } = buildService({
        authRepo: { findById: fn(() => baseAuth({ id: 'auth-1', userId: 'user-1' })) },
        usersRepo: { findById: fn(() => ({ status: 'INACTIVE' })) },
      })
      const token = await createJWT(
        { sub: 'auth-1', purpose: REACTIVATION_TOKEN_PURPOSE },
        'a-completely-different-secret',
        { expiration: '5m' },
      )

      await assertRejects(
        () => service.confirmReactivation(token),
        HttpError,
        'invalid or has expired',
      )
      assertEquals(usersRepo.reactivate.calls.length, 0)
    })
  },
)
