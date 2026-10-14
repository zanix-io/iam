import { StepUpClaimRepository } from 'server/repositories/step-up-claim/entity.provider.ts'
import { mintStepUpToken } from 'utils/step-up-token.ts'
import { FACTOR_CHANGE_PURPOSE, type FactorChangeOperation } from 'utils/shared-enums.ts'
import { STEP_UP_TOKEN_LOCALS_KEY } from 'utils/step-up-token-guard.ts'
import { withStepUpKeys } from './step-up.ts'

/** An in-memory `StepUpClaimRepository`: the first claim of a key wins, as the unique index does. */
export function fakeClaimRepo() {
  const held = new Set<string>()
  const calls: string[] = []
  return {
    held,
    calls,
    claim: (key: string, _expireAt: Date) => {
      calls.push(key)
      if (held.has(key)) return Promise.resolve(false)
      held.add(key)
      return Promise.resolve(true)
    },
  }
}

/** The `[class, fake]` entry to add to a test's providers map. */
export function claimProviderEntry(repo: ReturnType<typeof fakeClaimRepo> = fakeClaimRepo()) {
  return [StepUpClaimRepository, repo] as [unknown, unknown]
}

/** Mints a `factor-change` step-up token for `subject` and `operation`, signed with the test keys. */
export function factorChangeToken(
  subject: string,
  operation: string,
  overrides: { purpose?: string; subject?: string } = {},
): Promise<string> {
  return withStepUpKeys(async () =>
    (await mintStepUpToken({
      subject: overrides.subject ?? subject,
      purpose: overrides.purpose ?? FACTOR_CHANGE_PURPOSE,
      method: 'otp',
      bind: operation,
    })).stepUpToken
  )
}

/** Which service method performs which factor-change operation. */
const OPERATION_OF_METHOD: Record<string, FactorChangeOperation> = {
  totpConfirm: 'totp-confirm',
  disableTotp: 'totp-disable',
  phoneConfirm: 'phone-confirm',
  disablePhone: 'phone-disable',
  setOtpNotifier: 'otp-notifier',
  changePwd: 'password-change',
  addPassword: 'password-add',
  removePassword: 'password-remove',
}

/**
 * Makes every factor-change method of `service` run with a fresh valid proof for its operation, as
 * a request carrying the header would, and with the test keys in the environment. A test of the
 * operation itself then needs no token of its own; a test of the proof check does not use this.
 */
export function grantFactorChangeProofs<S extends object>(service: S, subject = 'auth-1'): S {
  const target = service as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
  const context = (service as unknown as { context: { locals?: Record<string, unknown> } }).context
  for (const [method, operation] of Object.entries(OPERATION_OF_METHOD)) {
    const original = target[method]
    if (typeof original !== 'function') continue
    target[method] = async (...args: unknown[]) => {
      const token = await factorChangeToken(subject, operation)
      context.locals = { ...context.locals, [STEP_UP_TOKEN_LOCALS_KEY]: token }
      return await withStepUpKeys(() => original.apply(service, args))
    }
  }
  return service
}
