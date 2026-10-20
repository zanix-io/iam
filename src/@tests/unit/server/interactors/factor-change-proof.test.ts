import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { wireAuthServices } from '../../helpers/auth-services.ts'
import { HttpError } from '@zanix/errors'
import { ZanixAuthProvider } from '@zanix/auth'
import { NotifierProvider } from '@zanix/notifications'

import { AuthService } from 'server/interactors/auth.interactor.ts'
import { PasswordService } from 'server/interactors/password.interactor.ts'
import { AuthRepository } from 'server/repositories/auth/entity.provider.ts'
import { UsersRepository } from 'server/repositories/users/entity.provider.ts'
import { FACTOR_CHANGE_OPERATIONS, type FactorChangeOperation } from 'utils/shared-enums.ts'
import { IAM_ERROR_CODES } from 'utils/constants.ts'
import { fn, mapGetter, mockAccessor } from '../../helpers/mock.ts'
import {
  claimProviderEntry,
  factorChangeToken,
  fakeClaimRepo,
} from '../../helpers/factor-change.ts'
import { withStepUpKeys } from '../../helpers/step-up.ts'

/** The account of the scenario: signed in as `auth-1`, with whatever each operation needs to succeed. */
const account = () => ({
  id: 'auth-1',
  userId: 'user-1',
  email: { unmask: () => 'jane@example.com' },
  phone: { unmask: () => '+15551234567' },
  password: { verify: () => true },
  twoFactorAuthConfig: { method: 'totp', triggerOn: ['login'] },
  totpSecret: { decrypt: () => 'SECRET' },
  pendingTotpSecret: { decrypt: () => 'SECRET' },
  pendingTotpExpiresAt: new Date(Date.now() + 60_000),
})

/** One scenario per operation: how to call it, and what it writes. */
const OPERATIONS: Record<
  FactorChangeOperation,
  { service: 'auth' | 'password'; call: (s: never) => Promise<unknown>; auth?: () => object }
> = {
  'totp-confirm': {
    service: 'auth',
    call: (s: AuthService) => s.totpConfirm('123456'),
  },
  'totp-disable': { service: 'auth', call: (s: AuthService) => s.disableTotp() },
  'phone-confirm': {
    service: 'auth',
    call: (s: AuthService) => s.phoneConfirm('+15551234567', '123456'),
  },
  'phone-disable': { service: 'auth', call: (s: AuthService) => s.disablePhone() },
  'otp-notifier': { service: 'auth', call: (s: AuthService) => s.setOtpNotifier('sms') },
  'password-change': {
    service: 'password',
    call: (s: PasswordService) => s.changePwd('old', 'New1234Aa'),
  },
  'password-add': {
    service: 'password',
    call: (s: PasswordService) => s.addPassword('New1234Aa'),
    auth: () => ({ ...account(), password: undefined }),
  },
  'password-remove': { service: 'password', call: (s: PasswordService) => s.removePassword() },
  'totp-backup-codes': {
    service: 'auth',
    call: (s: AuthService) => s.regenerateBackupCodes(),
  },
} as never

function build(operation: FactorChangeOperation) {
  const scenario = OPERATIONS[operation]
  const claims = fakeClaimRepo()
  const authRepo = {
    findById: fn((..._args: unknown[]): unknown => (scenario.auth ?? account)()),
    updateAuth: fn((..._args: unknown[]) => ({})),
    setPhone: fn((..._args: unknown[]) => authRepo.updateAuth()),
    findIdByPhone: fn((..._args: unknown[]) => undefined),
    // Regenerating backup codes is a write of its own; it counts as the operation's write.
    replaceBackupCodes: fn((..._args: unknown[]) => authRepo.updateAuth()),
  }
  const authProvider = {
    totp: { verify: fn((..._args: unknown[]) => true) },
    otp: { verify: fn((..._args: unknown[]) => true) },
  }
  const service = scenario.service === 'auth'
    ? new AuthService('ctx-1')
    : new PasswordService('ctx-1')
  mockAccessor(
    service,
    'providers',
    mapGetter([
      [AuthRepository, authRepo],
      [ZanixAuthProvider, authProvider],
      [UsersRepository, { assertActive: fn(() => {}) }],
      [NotifierProvider, { email: fn(() => {}) }],
      claimProviderEntry(claims),
    ]),
  )
  const context: { session: { subject: string }; locals: Record<string, unknown> } = {
    session: { subject: 'auth-1' },
    locals: {},
  }
  mockAccessor(service, 'context', context)
  if (scenario.service === 'auth') wireAuthServices(service)
  const run = (token?: string) => {
    if (token === undefined) delete context.locals.stepUpToken
    else context.locals.stepUpToken = token
    return withStepUpKeys(() => scenario.call(service as never))
  }
  return { run, authRepo, claims }
}

const refusal = (promise: Promise<unknown>) => assertRejects(() => promise, HttpError)

for (const operation of FACTOR_CHANGE_OPERATIONS) {
  Deno.test(`factor change ${operation}: without a proof it is refused, says what to confirm and writes nothing`, async () => {
    const { run, authRepo } = build(operation)
    const error = await refusal(run())
    assertEquals(error.code, IAM_ERROR_CODES.factorChangeProofRequired)
    assertEquals(error.status.value, 403)
    assertEquals(error.meta, { stepUp: { purpose: 'factor-change', bind: operation } })
    assertEquals(authRepo.updateAuth.calls.length, 0)
  })

  Deno.test(`factor change ${operation}: a proof for another purpose, subject or operation, or a forged one, is refused`, async () => {
    const { run, authRepo, claims } = build(operation)
    const other = FACTOR_CHANGE_OPERATIONS.find((candidate) => candidate !== operation) as string
    const valid = await factorChangeToken('auth-1', operation)
    const tampered = `${valid.slice(0, -4)}${valid.endsWith('AAAA') ? 'BBBB' : 'AAAA'}`
    const wrong = [
      await factorChangeToken('auth-1', operation, { purpose: 'wallet-transfer' }),
      await factorChangeToken('auth-2', operation),
      await factorChangeToken('auth-1', other),
      tampered,
      'not-a-token',
    ]
    for (const token of wrong) {
      // deno-lint-ignore no-await-in-loop
      const error = await refusal(run(token))
      assertEquals(error.code, IAM_ERROR_CODES.factorChangeProofInvalid)
    }
    assertEquals(authRepo.updateAuth.calls.length, 0)
    assertEquals(claims.held.size, 0)
  })

  Deno.test(`factor change ${operation}: a valid proof is accepted once and refused the second time`, async () => {
    const { run, authRepo } = build(operation)
    const token = await factorChangeToken('auth-1', operation)

    await run(token)
    const writes = authRepo.updateAuth.calls.length
    assert(writes >= 1)

    // The confirmations also spend their one-time code first, so the refusal may come from either.
    const error = await refusal(run(token))
    assertEquals(error.status.value, 403)
    assertEquals(authRepo.updateAuth.calls.length, writes)
  })

  Deno.test(`factor change ${operation}: two concurrent uses of one proof let exactly one through`, async () => {
    const { run } = build(operation)
    const token = await factorChangeToken('auth-1', operation)
    const results = await Promise.allSettled([run(token), run(token)])
    assertEquals(results.filter((result) => result.status === 'fulfilled').length, 1)
  })
}
