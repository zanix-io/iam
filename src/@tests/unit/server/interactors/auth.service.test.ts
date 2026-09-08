import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'
import { ZanixAuthProvider } from '@zanix/auth'
import { NotifierProvider } from '@zanix/notifications'

import { AuthService } from 'server/interactors/auth.interactor.ts'
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
    authenticate: fn((..._args: unknown[]) => ({ accessToken: 'access', refreshToken: 'refresh' })),
  },
})

const defaultNotifier = () => ({
  email: fn((..._args: unknown[]) => {}),
})

const defaultUsersRepo = () => ({
  registerUser: fn((..._args: unknown[]): unknown => ({ id: 'user-1' })),
  assertActive: fn((..._args: unknown[]) => {}),
})

const defaultRolesRepo = () => ({
  findById: fn((..._args: unknown[]): unknown => undefined),
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
  assertEquals(rolesRepo.findById.calls.length, 0)
})

Deno.test('loginWithPassword: with a role assigned, embeds its resolved active permissions', async () => {
  const { service, authProvider, rolesRepo } = buildService({
    authRepo: { findByEmail: fn(() => baseAuth({ roleId: 'role-1' })) },
    rolesRepo: {
      findById: fn(() => ({
        id: 'role-1',
        permissions: [
          { id: 'p1', code: 'zanix-iam:role-read', isActive: true },
          { id: 'p2', code: 'zanix-iam:role-write', isActive: false },
        ],
      })),
    },
  })
  await service.loginWithPassword('jane@example.com', 'secret')
  assertEquals(rolesRepo.findById.calls[0], ['role-1', { populate: 'permissions' }])
  assertEquals(
    (authProvider.session.generateTokens.calls[0]?.[0] as { permissions?: string[] }).permissions,
    ['zanix-iam:role-read'],
  )
})

Deno.test('loginWithOTPCallback: embeds the resolved role permissions', async () => {
  const { service, authProvider } = buildService({
    authRepo: { findByEmail: fn(() => baseAuth({ roleId: 'role-1' })) },
    rolesRepo: {
      findById: fn(() => ({
        id: 'role-1',
        permissions: [{ id: 'p1', code: 'zanix-iam:role-read', isActive: true }],
      })),
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

Deno.test('loginWithTOTPCallback: embeds the resolved role permissions', async () => {
  const { service, authProvider } = buildService({
    authRepo: {
      findByEmail: fn(() =>
        baseAuth({ roleId: 'role-1', totpSecret: { decrypt: () => 'SECRET' } })
      ),
    },
    rolesRepo: {
      findById: fn(() => ({
        id: 'role-1',
        permissions: [{ id: 'p1', code: 'zanix-iam:role-read', isActive: true }],
      })),
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
      findById: fn(() => baseAuth({ roleId: 'role-1' })),
    },
    rolesRepo: {
      findById: fn(() => ({
        id: 'role-1',
        permissions: [{ id: 'p1', code: 'zanix-iam:role-write', isActive: true }],
      })),
    },
  })
  await service.refreshTokens(fakeRefreshToken('auth-1'))
  // The CURRENT role's permissions are re-resolved on every refresh now — not just at login —
  // and passed straight through as `session.refreshTokens`'s own `sessionOptions` override. A
  // role reassigned after the original login (see `RolesService.assignRole`'s own doc) is
  // reflected on the very next refresh, with no forced re-login needed.
  assertEquals(rolesRepo.findById.calls[0], ['role-1', { populate: 'permissions' }])
  assertEquals(authProvider.session.refreshTokens.calls[0]?.[1], {
    permissions: ['zanix-iam:role-write'],
  })
})

Deno.test('refreshTokens: with no account resolvable from the token, still asks for [] permissions (never re-resolves)', async () => {
  const { service, rolesRepo, authProvider } = buildService({
    authRepo: { findById: fn(() => undefined) },
  })
  await assertRejects(() => service.refreshTokens(fakeRefreshToken('missing-auth')), HttpError)
  assertEquals(rolesRepo.findById.calls.length, 0)
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

Deno.test('loginWithPassword: throws FORBIDDEN when the linked users profile is deactivated', async () => {
  const { service } = buildService({
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
})

Deno.test('totpEnroll: throws UNAUTHORIZED with no session', () => {
  const { service } = buildService({ session: {} })
  let threw = false
  try {
    service.totpEnroll()
  } catch (error) {
    threw = error instanceof HttpError
  }
  assertEquals(threw, true)
})

Deno.test('totpEnroll: returns a secret and provisioning URI, persisting nothing', () => {
  const { service, authRepo } = buildService()
  const result = service.totpEnroll()
  assertEquals(result.secret, 'SECRET')
  assertEquals(result.uri, 'otpauth://totp/...')
  assertEquals(authRepo.updateAuth.calls.length, 0)
})

Deno.test('totpConfirm: throws FORBIDDEN when the code does not verify', async () => {
  const { service, authRepo } = buildService({
    authProvider: { totp: { ...defaultAuthProvider().totp, verify: fn(() => false) } },
  })
  await assertRejects(() => service.totpConfirm('SECRET', '000000'), HttpError, 'Invalid TOTP code')
  assertEquals(authRepo.updateAuth.calls.length, 0)
})

Deno.test('totpConfirm: on success persists the secret and sends the totp-enabled notification', async () => {
  const { service, authRepo, notifier } = buildService()
  const result = await service.totpConfirm('SECRET', '123456')
  assertEquals(result, { response: 'TOTP enabled' })
  const update = authRepo.updateAuth.calls[0]?.[0] as Record<string, unknown>
  assertEquals(update.totpSecret, 'SECRET')
  assertEquals(
    (update.twoFactorAuthConfig as { method: string }).method,
    'totp',
  )
  assertEquals(notifier.email.calls.length, 1)
  assertEquals((notifier.email.calls[0]?.[0] as { to: string }).to, 'jane@example.com')
})

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

  assertEquals(generateAuthUrl.calls[0], [{ state: 'caller-supplied-state' }])
})

Deno.test('loginWithOauth: forwards undefined when called with no state', () => {
  const { service } = buildService()
  const generateAuthUrl = fn((..._args: unknown[]) => ({
    url: 'https://provider/auth',
    state: 'x',
  }))
  mockAccessor(service, 'getOauthConnector', fn(() => ({ generateAuthUrl })))

  service.loginWithOauth('google')

  assertEquals(generateAuthUrl.calls[0], [{ state: undefined }])
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

Deno.test('loginWithOauthCallback: an existing account already linked to the SAME provider just logs in', async () => {
  const { service, authRepo, usersRepo } = buildService({
    authRepo: { findByEmail: fn(() => baseAuth({ oauthProvider: 'google', userId: 'user-1' })) },
  })
  withOauthConnector(service, () => ({ email: 'jane@example.com', verified_email: true }))

  const result = await service.loginWithOauthCallback('code', 'google') as Record<string, unknown>

  assertEquals(usersRepo.assertActive.calls[0], ['user-1'])
  assertEquals(authRepo.registerAuth.calls.length, 0)
  assertEquals(result.accessToken, 'access')
})

Deno.test('loginWithOauthCallback: throws FORBIDDEN when the linked users profile is deactivated', async () => {
  const { service } = buildService({
    authRepo: { findByEmail: fn(() => baseAuth({ oauthProvider: 'google', userId: 'user-1' })) },
    usersRepo: {
      assertActive: fn(() => {
        throw new HttpError('FORBIDDEN', { message: 'This account has been deactivated.' })
      }),
    },
  })
  withOauthConnector(service, () => ({ email: 'jane@example.com', verified_email: true }))

  await assertRejects(
    () => service.loginWithOauthCallback('code', 'google'),
    HttpError,
    'deactivated',
  )
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
  // Regression guard for the rotation-grace window `@zanix/auth@1.1.2` ships
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
