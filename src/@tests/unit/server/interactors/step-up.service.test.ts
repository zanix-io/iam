import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'
import {
  decodeJWT,
  generateOTP,
  generateTOTP,
  generateTOTPSecret,
  verifyOTP,
  verifyTOTP,
  ZanixAuthProvider,
} from '@zanix/auth'
import { NotifierProvider } from '@zanix/notifications'

import { stepUpOtpTarget, StepUpService } from 'server/interactors/step-up.interactor.ts'
import { AuthRepository } from 'server/repositories/auth/entity.provider.ts'
import { UsersRepository } from 'server/repositories/users/entity.provider.ts'
import { MESSAGES_ENV, STEP_UP_CODE_TTL_SECONDS } from 'utils/constants.ts'
import { fn, mapGetter, mockAccessor } from '../../helpers/mock.ts'
import { claimProviderEntry, fakeClaimRepo } from '../../helpers/factor-change.ts'
import { verifyStepUpToken, withStepUpKeys } from '../../helpers/step-up.ts'

/** An in-memory stand-in for the `cache` provider's local store with a controllable clock, so the
 * real `generateOTP`/`verifyOTP` (single use, attempt cap, expiry) run against it. */
function fakeOtpCache() {
  let now = 0
  const store = new Map<string, { value: unknown; expiresAt: number }>()
  return {
    advance: (seconds: number) => void (now += seconds * 1000),
    local: {
      get: (key: string) => {
        const entry = store.get(key)
        if (!entry) return undefined
        if (entry.expiresAt <= now) {
          store.delete(key)
          return undefined
        }
        return entry.value
      },
      set: (key: string, value: unknown, options?: { exp?: number }) =>
        void store.set(key, { value, expiresAt: now + (options?.exp ?? 1e9) * 1000 }),
      delete: (key: string) => void store.delete(key),
    },
  }
}

const baseAuth = (overrides: Record<string, unknown> = {}) => ({
  id: 'auth-1',
  userId: 'user-1',
  email: { unmask: () => 'jane@example.com' },
  phone: undefined,
  otpNotifier: undefined,
  twoFactorAuthConfig: undefined,
  totpSecret: undefined,
  ...overrides,
})

function buildService(opts: {
  auth?: Record<string, unknown> | undefined | null
  session?: Record<string, unknown>
  assertActive?: () => void
  cache?: ReturnType<typeof fakeOtpCache>
} = {}) {
  const cache = opts.cache ?? fakeOtpCache()
  const claims = fakeClaimRepo()
  const authRepo = {
    findById: fn((..._args: unknown[]): unknown =>
      opts.auth === null ? undefined : (opts.auth ?? baseAuth())
    ),
  }
  const usersRepo = { assertActive: fn((..._args: unknown[]) => opts.assertActive?.()) }
  const notifier = { sendMessage: fn((..._args: unknown[]) => {}) }
  // The real OTP and TOTP functions, over the fake cache: the factor mechanics under test are the
  // library's own.
  const authProvider = {
    otp: {
      generate: fn((options: { target: string; exp?: number }) =>
        generateOTP(cache as never, options)
      ),
      verify: fn((target: string, code: string) => verifyOTP(cache as never, target, code)),
    },
    totp: {
      verify: fn((secret: string, code: string, options?: { window?: number }) =>
        verifyTOTP(secret, code, options)
      ),
    },
  }

  const service = new StepUpService('ctx-1')
  mockAccessor(
    service,
    'providers',
    mapGetter([
      [AuthRepository, authRepo],
      [UsersRepository, usersRepo],
      [NotifierProvider, notifier],
      [ZanixAuthProvider, authProvider],
      claimProviderEntry(claims),
    ]),
  )
  mockAccessor(service, 'context', {
    session: opts.session ?? { subject: 'auth-1' },
    locals: { messageLang: 'es' },
  })
  return { service, cache, authRepo, usersRepo, notifier, authProvider, claims }
}

/** The one-time code of a sent message: the email's `buttonText`, or inside the SMS and WhatsApp `content`. */
const sentCode = (
  notifier: { sendMessage: { calls: unknown[][] } },
  index = 0,
): string => {
  const { content, buttonText } = (notifier.sendMessage.calls[index][1] as {
    data: { content: string; buttonText?: string }
  }).data
  const code = buttonText ?? content.match(/\b(\d{6})\b/)?.[1]
  if (!code) throw new Error(`no code in: ${content}`)
  return code
}

const statusOf = (error: unknown) => (error as { status: { value: number } }).status.value

/** The totp account: a real secret whose `decrypt()` gives it back, as `HydratedAuth` does. */
function totpAccount() {
  const secret = generateTOTPSecret()
  return {
    secret,
    auth: baseAuth({
      twoFactorAuthConfig: { method: 'totp', triggerOn: ['login'] },
      totpSecret: { decrypt: () => Promise.resolve(secret) },
    }),
  }
}

Deno.test('request: an account without TOTP gets an email code by default and the answer names the channel', async () => {
  const { service, notifier, authProvider } = buildService()
  const result = await service.request('wallet-transfer')

  assertEquals(result, {
    method: 'otp',
    channel: 'email',
    expiresInSeconds: STEP_UP_CODE_TTL_SECONDS,
  })
  const [channel, message, sendOptions] = notifier.sendMessage.calls[0] as [
    string,
    Record<string, unknown>,
    unknown,
  ]
  assertEquals(channel, 'email')
  assertEquals(message.to, 'jane@example.com')
  assertEquals(message.zanixTemplate, 'generic')
  assertEquals(message.lang, 'es')
  assertEquals(message.subject, 'Confirma una acción')
  // The code and its validity reach the message; the purpose selects wording only.
  const data = message.data as { content: string; buttonText: string; message: string }
  assertEquals(data.buttonText, sentCode(notifier))
  assertEquals(data.content.includes(data.buttonText), false)
  assertEquals(data.message.includes('5 minutos'), true)
  assertEquals(JSON.stringify(message).includes('wallet-transfer'), false)
  assertEquals(sendOptions, { useWorker: 'one-time' })
  // The code is generated for the purpose-scoped target, with the step-up lifetime.
  assertEquals(authProvider.otp.generate.calls, [[{
    target: stepUpOtpTarget('wallet-transfer', 'auth-1'),
    exp: STEP_UP_CODE_TTL_SECONDS,
  }]])
})

Deno.test('request: each configured notifier is used, with the destination it needs', async () => {
  for (const channel of ['sms', 'whatsapp'] as const) {
    const { service, notifier } = buildService({
      auth: baseAuth({ otpNotifier: channel, phone: { unmask: () => '+14155551234' } }),
    })
    // deno-lint-ignore no-await-in-loop
    const result = await service.request('wallet-transfer')
    assertEquals(result.method, 'otp')
    assertEquals(result.channel, channel)
    const [sentChannel, message] = notifier.sendMessage.calls[0] as [
      string,
      Record<string, unknown>,
    ]
    assertEquals(sentChannel, channel)
    assertEquals(message.to, '+14155551234')
    assertEquals(message.zanixTemplate, 'generic')
    assertEquals(message.subject, undefined)
    const { content } = message.data as { content: string }
    assertEquals(content.includes(sentCode(notifier)), true)
    assertEquals(content.includes('5 minutos'), true)
  }
})

Deno.test('request: a phone notifier with no phone on file is a 400 and generates no code', async () => {
  const { service, notifier, authProvider } = buildService({
    auth: baseAuth({ otpNotifier: 'sms' }),
  })
  const error = await assertRejects(() => service.request('wallet-transfer'), HttpError)
  assertEquals(statusOf(error), 400)
  assertEquals(authProvider.otp.generate.calls.length, 0)
  assertEquals(notifier.sendMessage.calls.length, 0)
})

Deno.test('request: TOTP enabled answers totp and sends nothing, whatever the notifier setting', async () => {
  const { auth } = totpAccount()
  const { service, notifier, authProvider } = buildService({
    auth: { ...auth, otpNotifier: 'sms', phone: { unmask: () => '+14155551234' } },
  })
  const result = await service.request('wallet-transfer')

  assertEquals(result, { method: 'totp', expiresInSeconds: STEP_UP_CODE_TTL_SECONDS })
  assertEquals(notifier.sendMessage.calls.length, 0)
  assertEquals(authProvider.otp.generate.calls.length, 0)
})

Deno.test('request: no session is a 401; a missing account or a closed one is a 403', async () => {
  const anonymous = buildService({ session: {} })
  assertEquals(
    statusOf(await assertRejects(() => anonymous.service.request('wallet-transfer'), HttpError)),
    401,
  )
  const missing = buildService({ auth: null })
  assertEquals(
    statusOf(await assertRejects(() => missing.service.request('wallet-transfer'), HttpError)),
    403,
  )
  const closed = buildService({
    assertActive: () => {
      throw new HttpError('FORBIDDEN', { message: 'This account has been deactivated.' })
    },
  })
  assertEquals(
    statusOf(await assertRejects(() => closed.service.request('wallet-transfer'), HttpError)),
    403,
  )
  assertEquals(closed.notifier.sendMessage.calls.length, 0)
})

Deno.test('verify: the emailed code mints a token for the session subject, purpose, bind and method otp', () =>
  withStepUpKeys(async () => {
    const { service, notifier } = buildService()
    await service.request('wallet-transfer')
    const code = sentCode(notifier)

    const { stepUpToken, expiresAt } = await service.verify('wallet-transfer', code, 'tx-42')
    const payload = await verifyStepUpToken(stepUpToken, {
      purpose: 'wallet-transfer',
      subject: 'auth-1',
      bind: 'tx-42',
    })
    assertEquals(payload.method, 'otp')
    assertEquals(payload.exp, expiresAt)
  }))

Deno.test('verify: sub comes from the session account, never from the request', () =>
  withStepUpKeys(async () => {
    const { service, authRepo, notifier } = buildService({ session: { subject: 'auth-1' } })
    await service.request('wallet-transfer')
    const { stepUpToken } = await service.verify('wallet-transfer', sentCode(notifier))
    assertEquals(decodeJWT(stepUpToken).payload.sub, 'auth-1')
    // The only account looked up is the session's.
    assert(authRepo.findById.calls.every((args) => args[0] === 'auth-1'))
  }))

Deno.test('verify: without a bind the token has none', () =>
  withStepUpKeys(async () => {
    const { service, notifier } = buildService()
    await service.request('wallet-transfer')
    const { stepUpToken } = await service.verify('wallet-transfer', sentCode(notifier))
    assertEquals('bind' in decodeJWT(stepUpToken).payload, false)
  }))

Deno.test('verify: an emailed code works once; the second use is refused', () =>
  withStepUpKeys(async () => {
    const { service, notifier } = buildService()
    await service.request('wallet-transfer')
    const code = sentCode(notifier)
    await service.verify('wallet-transfer', code)

    const error = await assertRejects(() => service.verify('wallet-transfer', code), HttpError)
    assertEquals(statusOf(error), 403)
  }))

Deno.test('verify: a code for one purpose is refused for another, and still works for its own', () =>
  withStepUpKeys(async () => {
    const { service, notifier } = buildService()
    await service.request('wallet-transfer')
    const code = sentCode(notifier)

    const error = await assertRejects(() => service.verify('wallet-withdraw', code), HttpError)
    assertEquals(statusOf(error), 403)
    // Refusing it elsewhere did not burn it.
    await service.verify('wallet-transfer', code)
  }))

Deno.test('verify: a login code is refused as a step-up code, and a step-up code is refused as a login code', async () => {
  const { service, cache, notifier } = buildService()
  // The login flow stores its code under the bare account id.
  const loginCode = await generateOTP(cache as never, { target: 'auth-1' })
  assertEquals(
    statusOf(await assertRejects(() => service.verify('wallet-transfer', loginCode), HttpError)),
    403,
  )

  await service.request('wallet-transfer')
  const stepUpCode = sentCode(notifier)
  // `loginCode` and `stepUpCode` may coincide by chance; make the check about the stores, not codes.
  assertEquals(
    await verifyOTP(cache as never, 'auth-1', stepUpCode === loginCode ? '' : stepUpCode),
    false,
  )
  // The login code is still there: the failed step-up check did not touch it.
  assertEquals(await verifyOTP(cache as never, 'auth-1', loginCode), true)
})

Deno.test('verify: a wrong code counts attempts and the code is burned after the fifth', async () => {
  const { service, notifier } = buildService()
  await service.request('wallet-transfer')
  const code = sentCode(notifier)
  const wrong = code === '000000' ? '111111' : '000000'

  for (let attempt = 0; attempt < 5; attempt++) {
    // deno-lint-ignore no-await-in-loop
    const error = await assertRejects(() => service.verify('wallet-transfer', wrong), HttpError)
    assertEquals(statusOf(error), 403)
  }
  // The right code no longer works: the fifth failure burned it.
  const error = await assertRejects(() => service.verify('wallet-transfer', code), HttpError)
  assertEquals(statusOf(error), 403)
})

Deno.test('verify: a code is refused after it expires', async () => {
  const { service, notifier, cache } = buildService()
  await service.request('wallet-transfer')
  const code = sentCode(notifier)

  cache.advance(STEP_UP_CODE_TTL_SECONDS + 1)
  const error = await assertRejects(() => service.verify('wallet-transfer', code), HttpError)
  assertEquals(statusOf(error), 403)
})

Deno.test('verify: a code that was never requested is the same 403 as a wrong one', async () => {
  const { service, notifier } = buildService()
  const neverIssued = await assertRejects(
    () => service.verify('wallet-transfer', '123456'),
    HttpError,
  )
  await service.request('wallet-transfer')
  const wrong = await assertRejects(
    () => service.verify('wallet-transfer', sentCode(notifier) === '123456' ? '654321' : '123456'),
    HttpError,
  )
  assertEquals(statusOf(neverIssued), 403)
  assertEquals(statusOf(wrong), 403)
  assertEquals(neverIssued.message, wrong.message)
})

Deno.test('verify: with TOTP enabled only the authenticator code works, and the token says totp', () =>
  withStepUpKeys(async () => {
    const { auth, secret } = totpAccount()
    const { service, cache, authProvider } = buildService({ auth })
    const code = await generateTOTP(secret)

    const { stepUpToken } = await service.verify('wallet-transfer', code, 'tx-1')
    assertEquals(decodeJWT(stepUpToken).payload.method, 'totp')
    assertEquals(authProvider.totp.verify.calls.length, 1)

    // A live emailed-style code for the same purpose is not an alternative to the authenticator.
    const otpCode = await generateOTP(cache as never, {
      target: stepUpOtpTarget('wallet-transfer', 'auth-1'),
    })
    const wrongTotp = otpCode === code ? '000000' : otpCode
    const error = await assertRejects(() => service.verify('wallet-transfer', wrongTotp), HttpError)
    assertEquals(statusOf(error), 403)
    assertEquals(authProvider.otp.verify.calls.length, 0)
  }))

Deno.test('verify: a TOTP account with no stored secret is refused', async () => {
  const { service } = buildService({
    auth: baseAuth({ twoFactorAuthConfig: { method: 'totp', triggerOn: ['login'] } }),
  })
  const error = await assertRejects(() => service.verify('wallet-transfer', '123456'), HttpError)
  assertEquals(statusOf(error), 403)
})

Deno.test('verify: an account that cannot sign in or no longer exists gets the same 403', async () => {
  const closed = buildService({
    assertActive: () => {
      throw new HttpError('FORBIDDEN', { message: 'This account has been deactivated.' })
    },
  })
  const missing = buildService({ auth: null })
  const wrong = buildService()
  const errors = await Promise.all([
    assertRejects(() => closed.service.verify('wallet-transfer', '123456'), HttpError),
    assertRejects(() => missing.service.verify('wallet-transfer', '123456'), HttpError),
    assertRejects(() => wrong.service.verify('wallet-transfer', '123456'), HttpError),
  ])
  for (const error of errors) {
    assertEquals(statusOf(error), 403)
    assertEquals(error.message, errors[0].message)
  }
  assertEquals(closed.authProvider.otp.verify.calls.length, 0)
})

Deno.test('verify: no session is a 401', async () => {
  const { service } = buildService({ session: {} })
  const error = await assertRejects(() => service.verify('wallet-transfer', '123456'), HttpError)
  assertEquals(statusOf(error), 401)
})

Deno.test('stepUpOtpTarget: is scoped by purpose and subject and never equals a bare id or email', () => {
  assertEquals(stepUpOtpTarget('wallet-transfer', 'auth-1'), 'step-up:wallet-transfer:auth-1')
  assert(stepUpOtpTarget('a', 'auth-1') !== stepUpOtpTarget('b', 'auth-1'))
  assert(stepUpOtpTarget('a', 'auth-1') !== stepUpOtpTarget('a', 'auth-2'))
})

Deno.test('request: the wording of the code message follows IAM_MESSAGES for the purpose, else the neutral default', async () => {
  const original = Deno.env.get(MESSAGES_ENV)
  Deno.env.set(
    MESSAGES_ENV,
    JSON.stringify({ 'step-up.purpose.wallet-transfer': 'mover tu saldo' }),
  )
  try {
    const { service, notifier } = buildService()
    await service.request('wallet-transfer')
    await service.request('unlisted-purpose')
    const sent = notifier.sendMessage.calls.map((call) =>
      (call[1] as { data: { content: string } }).data.content
    )
    assertEquals(sent[0].includes('confirmar que quieres mover tu saldo.'), true)
    assertEquals(sent[1].includes('realizar una acción en tu cuenta'), true)
    assertEquals(sent[1].includes('unlisted-purpose'), false)
  } finally {
    if (original === undefined) Deno.env.delete(MESSAGES_ENV)
    else Deno.env.set(MESSAGES_ENV, original)
  }
})

Deno.test('verify: two concurrent verifications of one emailed code let exactly one through', () =>
  withStepUpKeys(async () => {
    const { service, notifier } = buildService()
    await service.request('factor-change')
    const code = sentCode(notifier)

    // The library burns the code only after checking it, so both checks see it live; the claim
    // decides which one wins.
    const results = await Promise.allSettled([
      service.verify('factor-change', code, 'totp-confirm'),
      service.verify('factor-change', code, 'totp-confirm'),
    ])
    assertEquals(results.filter((r) => r.status === 'fulfilled').length, 1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    assertEquals(statusOf(rejected.reason), 403)
  }))

Deno.test('verify: an authenticator code is accepted once per account within its window', () =>
  withStepUpKeys(async () => {
    const { auth, secret } = totpAccount()
    const { service } = buildService({ auth })
    const code = await generateTOTP(secret)

    await service.verify('factor-change', code, 'totp-disable')
    const error = await assertRejects(
      () => service.verify('factor-change', code, 'totp-disable'),
      HttpError,
    )
    assertEquals(statusOf(error), 403)
  }))

Deno.test('verify: two concurrent verifications of one authenticator code let exactly one through', () =>
  withStepUpKeys(async () => {
    const { auth, secret } = totpAccount()
    const { service } = buildService({ auth })
    const code = await generateTOTP(secret)

    const results = await Promise.allSettled([
      service.verify('factor-change', code),
      service.verify('factor-change', code),
    ])
    assertEquals(results.filter((r) => r.status === 'fulfilled').length, 1)
  }))

Deno.test('request: the factor-change purpose has built-in wording in English and Spanish', async () => {
  for (
    const [lang, phrase] of [['es', 'cambiar tu método de verificación'], [
      'en',
      'change your verification method',
    ]]
  ) {
    const { service, notifier } = buildService()
    mockAccessor(service, 'context', {
      session: { subject: 'auth-1' },
      locals: { messageLang: lang },
    })
    // deno-lint-ignore no-await-in-loop
    await service.request('factor-change')
    const { data } = notifier.sendMessage.calls[0][1] as { data: { content: string } }
    assert(data.content.includes(phrase), data.content)
  }
})
