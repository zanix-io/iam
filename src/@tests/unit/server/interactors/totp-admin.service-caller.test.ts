import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@0.224'

import { IAM_ERROR_CODES, IAM_TOTP_RESET_SERVICES_ENV, totpResetServices } from 'utils/constants.ts'
import {
  ServiceLookupAccountRTO,
  ServiceTokenRTO,
  ServiceTotpResetRTO,
} from 'server/handlers/rtos/totp-admin.ts'
import { buildWorld, rejection } from '../../helpers/role-world.ts'
import { assertInvalid, validate } from '../../helpers/rto.ts'

const SERVICE = { subject: 'ops-console', type: 'api' as const, scope: [] }
const EMAIL = 'maria@totp-service.invalid'
const AUTH_ID = 'a'.repeat(24)

const world = (init: Parameters<typeof buildWorld>[0] = {}) =>
  buildWorld({
    accounts: [
      {
        id: 'maria',
        userId: 'user-maria',
        email: EMAIL,
        twoFactorAuthConfig: { method: 'totp', triggerOn: ['login'] },
        totpSecret: true,
        backupCodes: 7,
      },
      { id: 'plain', userId: 'user-plain', email: 'plain@totp-service.invalid' },
      { id: 'ghost', userId: 'user-ghost', email: 'ghost@totp-service.invalid' },
      { id: 'no-profile', email: 'np@totp-service.invalid' },
    ],
    profiles: { 'user-maria': 'ACTIVE', 'user-plain': 'INACTIVE', 'user-ghost': 'DELETED' },
    session: SERVICE,
    ...init,
  })

/** Runs `run` with `IAM_TOTP_RESET_SERVICES` set to `value` (`undefined` unsets it). */
async function withAllowlist<T>(value: string | undefined, run: () => Promise<T> | T): Promise<T> {
  const original = Deno.env.get(IAM_TOTP_RESET_SERVICES_ENV)
  if (value === undefined) Deno.env.delete(IAM_TOTP_RESET_SERVICES_ENV)
  else Deno.env.set(IAM_TOTP_RESET_SERVICES_ENV, value)
  try {
    return await run()
  } finally {
    if (original === undefined) Deno.env.delete(IAM_TOTP_RESET_SERVICES_ENV)
    else Deno.env.set(IAM_TOTP_RESET_SERVICES_ENV, original)
  }
}

const allowed = <T>(run: () => Promise<T> | T) => withAllowlist('ops-console', run)

Deno.test('totpResetServices: comma separated, trimmed, empty entries dropped, unset is empty', async () => {
  assertEquals(await withAllowlist(undefined, totpResetServices), [])
  assertEquals(await withAllowlist('', totpResetServices), [])
  assertEquals(await withAllowlist(' , ,', totpResetServices), [])
  assertEquals(await withAllowlist(' a, b ,,c', totpResetServices), ['a', 'b', 'c'])
})

Deno.test('service endpoints: an unset or empty allowlist refuses every service', async () => {
  for (const value of [undefined, '', '  ,']) {
    const w = world()
    // deno-lint-ignore no-await-in-loop
    const error = await withAllowlist(
      value,
      () => rejection(() => w.totp.resetTotpForService('maria', 'Lost phone', 'op-1')),
    )
    assertEquals([error.status.value, error.code], [403, IAM_ERROR_CODES.serviceNotAuthorized])
    assertEquals(w.state.authUpdates.length, 0)
    // deno-lint-ignore no-await-in-loop
    const lookup = await withAllowlist(
      value,
      () => rejection(() => w.totp.lookupAccountForService(EMAIL)),
    )
    assertEquals(lookup.code, IAM_ERROR_CODES.serviceNotAuthorized)
    // deno-lint-ignore no-await-in-loop
    const list = await withAllowlist(value, () => rejection(() => w.totp.listResetsForService()))
    assertEquals(list.code, IAM_ERROR_CODES.serviceNotAuthorized)
  }
})

Deno.test('service endpoints: a service that is not listed is refused, and the attempt is audited', async () => {
  const w = world({ session: { ...SERVICE, subject: 'notifications' } })
  const error = await allowed(() =>
    rejection(() => w.totp.resetTotpForService('maria', 'Lost phone', 'op-1'))
  )
  assertEquals([error.status.value, error.code], [403, IAM_ERROR_CODES.serviceNotAuthorized])
  assertEquals(w.state.authUpdates.length, 0)
  const [event] = w.events('totp.reset')
  assertEquals([event.result, event.actor, event.actorType], ['denied', 'notifications', 'api'])
})

Deno.test('service endpoints: a user session is refused, even one holding every permission', async () => {
  const w = world({ session: { subject: 'root', scope: ['*'] } })
  for (
    const call of [
      () => w.totp.resetTotpForService('maria', 'Lost phone', 'op-1'),
      () => w.totp.lookupAccountForService(EMAIL),
    ]
  ) {
    // deno-lint-ignore no-await-in-loop
    const error = await allowed(() => rejection(call))
    assertEquals(
      [error.status.value, error.code],
      [403, IAM_ERROR_CODES.serviceCredentialRequired],
    )
  }
  assertEquals(w.state.authUpdates.length, 0)
})

Deno.test('lookup: answers the ids, status, hasTotp and the backup codes left, never the email', async () => {
  const w = world()
  const found = await allowed(() => w.totp.lookupAccountForService(EMAIL))
  assertEquals(found, {
    authId: 'maria',
    userId: 'user-maria',
    status: 'ACTIVE',
    hasTotp: true,
    backupCodesRemaining: 7,
  })
  assertFalse(JSON.stringify(found).includes('totp-service.invalid'))
})

Deno.test('lookup: an INACTIVE person is found with that status and no authenticator', async () => {
  const w = world()
  const found = await allowed(() => w.totp.lookupAccountForService('plain@totp-service.invalid'))
  assertEquals([found.status, found.hasTotp, found.backupCodesRemaining], ['INACTIVE', false, 0])
})

Deno.test('lookup: an unknown address, a DELETED person and an account with no profile are the same 404', async () => {
  const w = world()
  const seen = new Set<string>()
  for (
    const email of [
      'nobody@totp-service.invalid',
      'ghost@totp-service.invalid',
      'np@totp-service.invalid',
    ]
  ) {
    // deno-lint-ignore no-await-in-loop
    const error = await allowed(() => rejection(() => w.totp.lookupAccountForService(email)))
    assertEquals([error.status.value, error.code], [404, IAM_ERROR_CODES.userNotFound])
    seen.add(`${error.message}`)
  }
  assertEquals(seen.size, 1)
})

Deno.test('lookup: is audited as accounts.service-lookup with the service as actor and no email', async () => {
  const w = world()
  await allowed(() => w.totp.lookupAccountForService(EMAIL))
  const [event] = w.events('accounts.service-lookup')
  assertEquals([event.result, event.actor, event.actorType], ['ok', 'ops-console', 'api'])
  assertFalse(JSON.stringify(w.state.audit).includes('totp-service.invalid'))
})

Deno.test('reset: has the effect of the operator reset and mails the owner', async () => {
  const original = Deno.env.get('TEMPLATES_BACKEND')
  Deno.env.set('TEMPLATES_BACKEND', 'local')
  try {
    const w = world()
    assertEquals(await allowed(() => w.totp.resetTotpForService('maria', 'Lost phone', 'op-1')), {
      response: 'TOTP reset',
    })
    const [, options] = w.state.authUpdates[0] as [unknown, { unset: string[] }]
    assertEquals(options.unset.sort(), [
      'backupCodeHashes',
      'backupCodesGeneratedAt',
      'pendingTotpExpiresAt',
      'pendingTotpSecret',
      'totpSecret',
      'twoFactorAuthConfig',
    ])
    assertEquals(w.state.emails.length, 1)
    const email = w.state.emails[0] as { to: string; zanixTemplate: string }
    assertEquals([email.to, email.zanixTemplate], [EMAIL, 'totp-reset-by-operator'])
  } finally {
    if (original === undefined) Deno.env.delete('TEMPLATES_BACKEND')
    else Deno.env.set('TEMPLATES_BACKEND', original)
  }
})

Deno.test('reset: the audit event names the service, the operator id and the reason', async () => {
  const w = world()
  await allowed(() => w.totp.resetTotpForService('maria', 'Lost phone, checked', 'staff-42'))
  const [event] = w.events('totp.reset')
  assertEquals([event.result, event.actor, event.actorType], ['ok', 'ops-console', 'api'])
  assertEquals(event.target, { kind: 'account', id: 'maria' })
  assertEquals(event.request, { reason: 'Lost phone, checked', operatorId: 'staff-42' })
  assertEquals(event.before, { totpEnabled: true, backupCodesRemaining: 7 })
})

Deno.test('reset: an operator id equal to the target is refused as TOTP_RESET_SELF', async () => {
  const w = world()
  const error = await allowed(() =>
    rejection(() => w.totp.resetTotpForService('maria', 'Lost phone', 'maria'))
  )
  assertEquals([error.status.value, error.code], [403, IAM_ERROR_CODES.totpResetSelf])
  assertEquals(w.state.authUpdates.length, 0)
})

Deno.test('reset: an account without an authenticator is 409, an unknown one 404, and nothing changes', async () => {
  const w = world()
  const conflict = await allowed(() =>
    rejection(() => w.totp.resetTotpForService('plain', 'Lost phone', 'op-1'))
  )
  assertEquals([conflict.status.value, conflict.code], [409, IAM_ERROR_CODES.totpNotEnabled])
  const missing = await allowed(() =>
    rejection(() => w.totp.resetTotpForService('nobody', 'Lost phone', 'op-1'))
  )
  assertEquals(missing.status.value, 404)
  assertEquals(w.state.authUpdates.length, 0)
})

Deno.test('reset: the audit fails closed, nothing is reset if the trail is down', async () => {
  const w = world({ failAudit: true })
  await allowed(() => rejection(() => w.totp.resetTotpForService('maria', 'Lost phone', 'op-1')))
  assertEquals(w.state.authUpdates.length, 0)
})

Deno.test('listResets: a listed service reads the totp.reset events; others are refused', async () => {
  const w = world()
  const page = await allowed(() =>
    w.totp.listResetsForService({ authId: 'maria', page: 2 })
  ) as unknown as { options: Record<string, unknown> }
  assertEquals(page.options.action, 'totp.reset')
  const user = world({ session: { subject: 'root', scope: ['*'] } })
  const error = await allowed(() => rejection(() => user.totp.listResetsForService()))
  assertEquals(error.code, IAM_ERROR_CODES.serviceCredentialRequired)
})

Deno.test('exchange: a service that is not listed, or an assertion that names none, is refused before any key is read', async () => {
  const w = world()
  const unsigned = (claims: Record<string, unknown>) => {
    const part = (value: unknown) => btoa(JSON.stringify(value)).replaceAll('=', '')
    return `${part({ alg: 'RS256', kid: 'x' })}.${part(claims)}.sig`
  }
  for (
    const assertion of [unsigned({ iss: 'notifications', sub: 'notifications' }), unsigned({})]
  ) {
    // deno-lint-ignore no-await-in-loop
    const error = await allowed(() => rejection(() => w.totp.exchangeServiceToken(assertion)))
    assertEquals([error.status.value, error.code], [403, IAM_ERROR_CODES.serviceNotAuthorized])
  }
  const garbage = await allowed(() => rejection(() => w.totp.exchangeServiceToken('not a jwt')))
  assertEquals(garbage.status.value, 400)
  const closed = await withAllowlist(
    undefined,
    () => rejection(() => w.totp.exchangeServiceToken(unsigned({ iss: 'ops-console' }))),
  )
  assertEquals(closed.code, IAM_ERROR_CODES.serviceNotAuthorized)
})

Deno.test('ServiceTotpResetRTO: operator is { id } with a safe opaque id', async () => {
  const base = { authId: AUTH_ID, reason: '  Lost phone ' }
  const ok = await validate(ServiceTotpResetRTO, { ...base, operator: { id: 'staff_42:a@b.c-d' } })
  assertEquals([ok.reason, ok.operator], ['Lost phone', { id: 'staff_42:a@b.c-d' }])
  await validate(ServiceTotpResetRTO, { ...base, operator: { id: 'x'.repeat(128) } })
  for (
    const operator of [
      undefined,
      null,
      'op',
      [],
      {},
      { id: '' },
      { id: 'x'.repeat(129) },
      { id: 'has space' },
      { id: 'new\nline' },
      { id: '<b>' },
      { id: 1 },
      { id: 'ok', extra: true },
    ]
  ) {
    // deno-lint-ignore no-await-in-loop
    await assertInvalid(ServiceTotpResetRTO, { ...base, operator }, ['operator'])
  }
  await assertInvalid(ServiceTotpResetRTO, { authId: 'nope', reason: 'r', operator: { id: 'a' } }, [
    'authId',
  ])
  await assertInvalid(
    ServiceTotpResetRTO,
    { ...base, reason: 'bad\u0000', operator: { id: 'a' } },
    [
      'reason',
    ],
  )
})

Deno.test('ServiceLookupAccountRTO and ServiceTokenRTO: an email and an assertion string', async () => {
  assertEquals((await validate(ServiceLookupAccountRTO, { email: '  a@b.co ' })).email, 'a@b.co')
  await assertInvalid(ServiceLookupAccountRTO, { email: 'not-an-email' }, ['email'])
  await assertInvalid(ServiceLookupAccountRTO, {}, ['email'])
  assert((await validate(ServiceTokenRTO, { assertion: 'a.b.c' })).assertion)
  await assertInvalid(ServiceTokenRTO, {}, ['assertion'])
})
