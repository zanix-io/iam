import { assert, assertEquals, assertNotEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { wireAuthServices } from '../../helpers/auth-services.ts'
import { HttpError } from '@zanix/errors'
import { generateTOTP, generateTOTPSecret, verifyTOTP, ZanixAuthProvider } from '@zanix/auth'
import { NotifierProvider } from '@zanix/notifications'

import { AuthService } from 'server/interactors/auth.interactor.ts'
import { StepUpService } from 'server/interactors/step-up.interactor.ts'
import { AuthRepository } from 'server/repositories/auth/entity.provider.ts'
import { UsersRepository } from 'server/repositories/users/entity.provider.ts'
import {
  generateBackupCodes,
  hashBackupCode,
  hashBackupCodes,
  normalizeBackupCode,
} from 'utils/backup-codes.ts'
import { IAM_ERROR_CODES } from 'utils/constants.ts'
import { fn, mapGetter, mockAccessor } from '../../helpers/mock.ts'
import {
  claimProviderEntry,
  factorChangeToken,
  fakeClaimRepo,
  grantFactorChangeProofs,
} from '../../helpers/factor-change.ts'
import { verifyStepUpToken, withStepUpKeys } from '../../helpers/step-up.ts'

async function withTemplates<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const original = Deno.env.get('TEMPLATES_BACKEND')
  if (value === undefined) Deno.env.delete('TEMPLATES_BACKEND')
  else Deno.env.set('TEMPLATES_BACKEND', value)
  try {
    return await run()
  } finally {
    if (original === undefined) Deno.env.delete('TEMPLATES_BACKEND')
    else Deno.env.set('TEMPLATES_BACKEND', original)
  }
}

/** What the library raises for a wrong authenticator code (`totp.authenticate`). */
const libraryRefusal = () =>
  new HttpError('FORBIDDEN', {
    code: 'INVALID_TOTP',
    cause: 'The provided TOTP code does not match the expected value.',
    meta: { source: 'zanix' },
  })

/**
 * The world of one account that has an authenticator app and `codes` as backup codes. The fake
 * repository keeps the digests in a set and spends one by removing it, which is the contract of
 * `AuthRepository.consumeBackupCode`: of two uses of one code exactly one finds it.
 */
async function world(opts: { codes?: string[]; totp?: boolean } = {}) {
  const secret = generateTOTPSecret()
  const totp = opts.totp ?? true
  const codes = opts.codes ?? generateBackupCodes()
  const hashes = new Set(totp ? await hashBackupCodes('auth-1', codes) : [])
  const auth = {
    id: 'auth-1',
    userId: 'user-1',
    email: { unmask: () => 'jane@example.com' },
    twoFactorAuthConfig: totp ? { method: 'totp', triggerOn: ['login'] } : undefined,
    totpSecret: totp ? { decrypt: () => Promise.resolve(secret) } : undefined,
    pendingTotpSecret: { decrypt: () => Promise.resolve(secret) },
    pendingTotpExpiresAt: new Date(Date.now() + 60_000),
    roleIds: [],
  }
  const claims = fakeClaimRepo()
  const authRepo = {
    findByEmail: fn((..._args: unknown[]): unknown => auth),
    findById: fn((..._args: unknown[]): unknown => auth),
    updateAuth: fn((..._args: unknown[]) => ({})),
    countBackupCodes: fn((..._args: unknown[]) => hashes.size),
    replaceBackupCodes: fn((_id: string, next: string[]) => {
      hashes.clear()
      for (const hash of next) hashes.add(hash)
      return {}
    }),
    consumeBackupCode: fn((_id: string, hash: string): number | undefined => {
      if (!hashes.delete(hash)) return undefined
      return hashes.size
    }),
  }
  const notifier = { email: fn((..._args: unknown[]) => {}) }
  const authProvider = {
    session: {
      generateTokens: fn((..._args: unknown[]) => ({ accessToken: 'a', refreshToken: 'r' })),
    },
    otp: { verify: fn((..._args: unknown[]) => false) },
    totp: {
      generateSecret: fn(() => 'SECRET'),
      verify: fn((s: string, code: string, options?: { window?: number }) =>
        verifyTOTP(s, code, options)
      ),
      authenticate: fn(async (s: string, code: string, _session: unknown, options?: never) => {
        if (!await verifyTOTP(s, code, options)) throw libraryRefusal()
        return { accessToken: 'a-totp', refreshToken: 'r-totp' }
      }),
    },
  }
  const providers = mapGetter([
    [AuthRepository, authRepo],
    [UsersRepository, {
      assertActive: fn(() => {}),
      findById: fn(() => ({ status: 'ACTIVE' })),
    }],
    [NotifierProvider, notifier],
    [ZanixAuthProvider, authProvider],
    [(await import('server/repositories/roles/entity.provider.ts')).RolesRepository, {
      findManyWithPermissions: fn(() => []),
    }],
    claimProviderEntry(claims),
  ])
  const context = { session: { subject: 'auth-1' }, locals: { messageLang: 'es' }, cookies: {} }

  const authService = new AuthService('ctx-1')
  mockAccessor(authService, 'providers', providers)
  mockAccessor(authService, 'context', context)
  const stepUp = new StepUpService('ctx-1')
  mockAccessor(stepUp, 'providers', providers)
  mockAccessor(stepUp, 'context', context)
  wireAuthServices(authService, [[StepUpService, stepUp]])
  return {
    secret,
    codes,
    hashes,
    auth,
    authRepo,
    notifier,
    authProvider,
    claims,
    authService,
    stepUp,
  }
}

const noticeOf = (notifier: { email: { calls: unknown[][] } }, index = 0) =>
  notifier.email.calls[index][0] as {
    to: string
    zanixTemplate: string
    lang: string
    data: { remaining: number }
  }

Deno.test('totpConfirm: returns 10 backup codes once and stores only their digests', async () => {
  const w = await world({ totp: false })
  grantFactorChangeProofs(w.authService)
  const secret = generateTOTPSecret()
  w.auth.pendingTotpSecret = { decrypt: () => Promise.resolve(secret) }
  w.authProvider.totp.verify = fn((..._args: unknown[]) => Promise.resolve(true)) as never
  const result = await w.authService.totpConfirm('123456')

  assertEquals(result.response, 'TOTP enabled')
  assertEquals(result.backupCodes.length, 10)
  assertEquals(new Set(result.backupCodes).size, 10)
  for (const code of result.backupCodes) assert(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(code))

  const [update] = w.authRepo.updateAuth.calls[0] as [Record<string, unknown>]
  const stored = update.backupCodeHashes as string[]
  assertEquals(stored.length, 10)
  assert(update.backupCodesGeneratedAt instanceof Date)
  const written = JSON.stringify(update)
  for (const code of result.backupCodes) {
    assert(!written.includes(code), 'the plaintext is never written')
    assert(!written.includes(code.replace('-', '')), 'nor its dashless form')
  }
  assertEquals(
    stored[0],
    await hashBackupCode('auth-1', normalizeBackupCode(result.backupCodes[0]) as string),
  )
})

Deno.test('totpConfirm: enrolling again issues a fresh set', async () => {
  const w = await world({ totp: false })
  grantFactorChangeProofs(w.authService)
  w.authProvider.totp.verify = fn((..._args: unknown[]) => Promise.resolve(true)) as never
  const first = await w.authService.totpConfirm('111111')
  const second = await w.authService.totpConfirm('222222')
  assertNotEquals(first.backupCodes, second.backupCodes)
})

Deno.test('login: a backup code signs in, is spent, and its owner is told how many remain', async () => {
  await withTemplates('local', async () => {
    const w = await world()
    const result = await w.authService.loginWithTOTPCallback('jane@example.com', w.codes[0])

    assertEquals(result.accessToken, 'a')
    assertEquals(w.authProvider.session.generateTokens.calls.length, 1)
    assertEquals(w.authProvider.totp.authenticate.calls.length, 0)
    assertEquals(w.hashes.size, 9)
    const notice = noticeOf(w.notifier)
    assertEquals(
      [notice.to, notice.zanixTemplate, notice.lang, notice.data],
      ['jane@example.com', 'totp-backup-code-used', 'es', { remaining: 9 }],
    )
  })
})

Deno.test('login: case, dashes and spaces of a typed backup code do not matter', async () => {
  const w = await world()
  const typed = w.codes[0].toLowerCase().replace('-', ' ')
  await w.authService.loginWithTOTPCallback('jane@example.com', typed)
  assertEquals(w.hashes.size, 9)
})

Deno.test('login: a backup code works once; a second use is refused like a wrong authenticator code', async () => {
  const w = await world()
  await w.authService.loginWithTOTPCallback('jane@example.com', w.codes[0])

  const reused = await assertRejects(
    () => w.authService.loginWithTOTPCallback('jane@example.com', w.codes[0]),
    HttpError,
  )
  const wrongBackup = await assertRejects(
    () => w.authService.loginWithTOTPCallback('jane@example.com', 'ZZZZZ-ZZZZZ'),
    HttpError,
  )
  const wrongTotp = await assertRejects(
    () => w.authService.loginWithTOTPCallback('jane@example.com', '000000'),
    HttpError,
  )
  for (const error of [reused, wrongBackup]) {
    assertEquals(error.status.value, wrongTotp.status.value)
    assertEquals(error.code, wrongTotp.code)
    assertEquals(error.message, wrongTotp.message)
    assertEquals(error.meta, wrongTotp.meta)
  }
  assertEquals(w.hashes.size, 9)
})

Deno.test('login: two concurrent uses of one backup code let exactly one through', async () => {
  const w = await world()
  const results = await Promise.allSettled([
    w.authService.loginWithTOTPCallback('jane@example.com', w.codes[3]),
    w.authService.loginWithTOTPCallback('jane@example.com', w.codes[3]),
  ])
  assertEquals(results.filter((result) => result.status === 'fulfilled').length, 1)
  assertEquals(w.hashes.size, 9)
})

Deno.test('login: the notice at zero remaining says none are left', async () => {
  await withTemplates('local', async () => {
    const w = await world({ codes: generateBackupCodes(1) })
    await w.authService.loginWithTOTPCallback('jane@example.com', w.codes[0])
    assertEquals(noticeOf(w.notifier).data, { remaining: 0 })
    assertEquals(w.hashes.size, 0)
  })
})

Deno.test('login: no database-backed templates means no notice, and the sign-in still succeeds', async () => {
  await withTemplates(undefined, async () => {
    const w = await world()
    await w.authService.loginWithTOTPCallback('jane@example.com', w.codes[0])
    assertEquals(w.notifier.email.calls.length, 0)
    assertEquals(w.hashes.size, 9)
  })
})

Deno.test('login: a notice that cannot be sent does not undo the spend', async () => {
  await withTemplates('local', async () => {
    const w = await world()
    w.notifier.email = fn(() => {
      throw new Error('smtp down')
    })
    const result = await w.authService.loginWithTOTPCallback('jane@example.com', w.codes[0])
    assertEquals(result.accessToken, 'a')
    assertEquals(w.hashes.size, 9)
  })
})

Deno.test('login: an authenticator code never touches the backup codes, and sends no notice', async () => {
  await withTemplates('local', async () => {
    const w = await world()
    const code = await generateTOTP(w.secret)
    const result = await w.authService.loginWithTOTPCallback('jane@example.com', code)
    assertEquals(result.accessToken, 'a-totp')
    assertEquals(w.authRepo.consumeBackupCode.calls.length, 0)
    assertEquals(w.notifier.email.calls.length, 0)
    assertEquals(w.hashes.size, 10)
  })
})

Deno.test('login: a backup code never spends an authenticator-code claim', async () => {
  const w = await world()
  await w.authService.loginWithTOTPCallback('jane@example.com', w.codes[0])
  assertEquals(w.claims.held.size, 0)
})

Deno.test('step-up verify: a backup code is accepted for a TOTP account and mints a token for the same purpose and bind', async () => {
  await withTemplates('local', async () => {
    const w = await world()
    const { stepUpToken } = await withStepUpKeys(() =>
      w.stepUp.verify('factor-change', w.codes[1], 'totp-disable')
    )
    const claims = await verifyStepUpToken(stepUpToken, {
      purpose: 'factor-change',
      subject: 'auth-1',
      bind: 'totp-disable',
    })
    assertEquals(claims.method, 'totp')
    assertEquals(w.hashes.size, 9)
    assertEquals(noticeOf(w.notifier).data, { remaining: 9 })
  })
})

Deno.test('step-up verify: a spent or wrong backup code is the generic refusal, and a code is spent once', async () => {
  const w = await world()
  await withStepUpKeys(() => w.stepUp.verify('factor-change', w.codes[1]))
  const outcomes = []
  for (const code of [w.codes[1], 'ZZZZZ-ZZZZZ', '000000']) {
    // deno-lint-ignore no-await-in-loop
    outcomes.push(await assertRejects(() => w.stepUp.verify('factor-change', code), HttpError))
  }
  for (const error of outcomes) {
    assertEquals(error.status.value, 403)
    assertEquals(error.message, outcomes[0].message)
  }
})

Deno.test('step-up verify: concurrent verifications of one backup code let exactly one through', async () => {
  const w = await world()
  const results = await withStepUpKeys(() =>
    Promise.allSettled([
      w.stepUp.verify('factor-change', w.codes[2]),
      w.stepUp.verify('factor-change', w.codes[2]),
    ])
  )
  assertEquals(results.filter((result) => result.status === 'fulfilled').length, 1)
})

Deno.test('step-up verify: an account without TOTP does not read a backup-shaped code as one', async () => {
  const w = await world({ totp: false })
  await assertRejects(() => w.stepUp.verify('wallet-transfer', 'ABCDE-FGHJK'), HttpError)
  assertEquals(w.authRepo.consumeBackupCode.calls.length, 0)
})

Deno.test('getOwnAuthMethods: reports how many backup codes remain, never the codes', async () => {
  const w = await world()
  const methods = await w.authService.getOwnAuthMethods()
  assertEquals(methods.backupCodesRemaining, 10)
  const text = JSON.stringify(methods)
  for (const code of w.codes) assert(!text.includes(code.replace('-', '')))
  await w.authService.loginWithTOTPCallback('jane@example.com', w.codes[0])
  assertEquals((await w.authService.getOwnAuthMethods()).backupCodesRemaining, 9)
})

Deno.test('getOwnAuthMethods: 0 without TOTP, and the count is not even read', async () => {
  const w = await world({ totp: false })
  assertEquals((await w.authService.getOwnAuthMethods()).backupCodesRemaining, 0)
  assertEquals(w.authRepo.countBackupCodes.calls.length, 0)
})

Deno.test('regenerateBackupCodes: replaces the whole set, answers the new codes once and stores digests', async () => {
  const w = await world()
  grantFactorChangeProofs(w.authService)
  const { backupCodes } = await w.authService.regenerateBackupCodes()

  assertEquals(backupCodes.length, 10)
  for (const old of w.codes) assert(!backupCodes.includes(old))
  const [id, stored] = w.authRepo.replaceBackupCodes.calls[0] as [string, string[]]
  assertEquals([id, stored.length], ['auth-1', 10])
  assert(!JSON.stringify(stored).includes(backupCodes[0].replace('-', '')))
  assertEquals(w.hashes.size, 10)
  // The old codes no longer work; a new one does.
  await assertRejects(
    () => w.authService.loginWithTOTPCallback('jane@example.com', w.codes[0]),
    HttpError,
  )
  await w.authService.loginWithTOTPCallback('jane@example.com', backupCodes[0])
})

Deno.test('regenerateBackupCodes: an account without an authenticator app gets a clear 409 and keeps its proof', async () => {
  const w = await world({ totp: false })
  const token = await factorChangeToken('auth-1', 'totp-backup-codes')
  mockAccessor(w.authService, 'context', {
    session: { subject: 'auth-1' },
    locals: { stepUpToken: token },
  })
  const error = await withStepUpKeys(() =>
    assertRejects(() => w.authService.regenerateBackupCodes(), HttpError)
  )
  assertEquals([error.status.value, error.code], [409, IAM_ERROR_CODES.totpNotEnabled])
  assertEquals(w.claims.held.size, 0)
  assertEquals(w.authRepo.replaceBackupCodes.calls.length, 0)
})

Deno.test('regenerateBackupCodes: an account that enabled TOTP before backup codes existed gets its first set', async () => {
  const w = await world({ codes: [] })
  grantFactorChangeProofs(w.authService)
  assertEquals((await w.authService.getOwnAuthMethods()).backupCodesRemaining, 0)
  const { backupCodes } = await w.authService.regenerateBackupCodes()
  assertEquals(backupCodes.length, 10)
  assertEquals((await w.authService.getOwnAuthMethods()).backupCodesRemaining, 10)
})
