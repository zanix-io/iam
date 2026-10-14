import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@0.224'

import { IAM_ERROR_CODES, RBAC_PERMISSIONS } from 'utils/constants.ts'
import { SearchTotpResetsRTO, TotpResetRTO } from 'server/handlers/rtos/totp-admin.ts'
import { buildWorld, perm, rejection, role } from '../../helpers/role-world.ts'
import { assertInvalid, validate } from '../../helpers/rto.ts'

const OPERATOR = { subject: 'operator', scope: [RBAC_PERMISSIONS.totpReset] }
const EMAIL = 'maria@totp-reset.invalid'
const TOTP_CONFIG = { method: 'totp', triggerOn: ['login'] }

const world = (init: Parameters<typeof buildWorld>[0] = {}) =>
  buildWorld({
    accounts: [
      {
        id: 'maria',
        userId: 'user-maria',
        email: EMAIL,
        twoFactorAuthConfig: TOTP_CONFIG,
        totpSecret: true,
        pendingTotpSecret: true,
        backupCodes: 7,
      },
      { id: 'plain', userId: 'user-plain', email: 'plain@totp-reset.invalid' },
      {
        id: 'by-email',
        userId: 'user-by-email',
        email: 'otp@totp-reset.invalid',
        twoFactorAuthConfig: { method: 'email', triggerOn: ['login'] },
      },
    ],
    profiles: { 'user-maria': 'ACTIVE', 'user-plain': 'ACTIVE', 'user-by-email': 'ACTIVE' },
    session: OPERATOR,
    ...init,
  })

async function withTemplates<T>(run: () => Promise<T>): Promise<T> {
  const original = Deno.env.get('TEMPLATES_BACKEND')
  Deno.env.set('TEMPLATES_BACKEND', 'local')
  try {
    return await run()
  } finally {
    if (original === undefined) Deno.env.delete('TEMPLATES_BACKEND')
    else Deno.env.set('TEMPLATES_BACKEND', original)
  }
}

Deno.test('reset: removes the secret, the TOTP setting, a pending enrollment and every backup code', async () => {
  const w = world()
  assertEquals(await w.totp.resetTotp('maria', 'Lost phone, identity checked'), {
    response: 'TOTP reset',
  })
  const [data, options] = w.state.authUpdates[0] as [
    { id: string },
    { unset: string[] },
  ]
  assertEquals(data, { id: 'maria' })
  assertEquals(options.unset.sort(), [
    'backupCodeHashes',
    'backupCodesGeneratedAt',
    'pendingTotpExpiresAt',
    'pendingTotpSecret',
    'totpSecret',
    'twoFactorAuthConfig',
  ])
  const account = w.account('maria') as NonNullable<ReturnType<typeof w.account>>
  assertEquals(account.twoFactorAuthConfig, undefined)
  assertEquals(account.totpSecret, undefined)
  assertEquals(account.backupCodes, undefined)
})

Deno.test('reset: the second-factor setting is cleared only when it is the authenticator app', async () => {
  const w = world({
    accounts: [{
      id: 'pending-only',
      userId: 'user-p',
      pendingTotpSecret: true,
      totpSecret: true,
      twoFactorAuthConfig: { method: 'email', triggerOn: ['login'] },
    }],
    profiles: { 'user-p': 'ACTIVE' },
  })
  await w.totp.resetTotp('pending-only', 'Stale secret')
  const [, options] = w.state.authUpdates[0] as [unknown, { unset: string[] }]
  assertFalse(options.unset.includes('twoFactorAuthConfig'))
  assert(options.unset.includes('totpSecret'))
})

Deno.test('reset: the owner is emailed that support removed the second step, without the reason', async () => {
  await withTemplates(async () => {
    const w = world()
    await w.totp.resetTotp('maria', 'secret internal note')
    assertEquals(w.state.emails.length, 1)
    const email = w.state.emails[0] as { to: string; zanixTemplate: string; data: unknown }
    assertEquals([email.to, email.zanixTemplate, email.data], [EMAIL, 'totp-reset-by-operator', {}])
    assertFalse(JSON.stringify(email).includes('internal note'))
  })
})

Deno.test('reset: without database-backed templates nothing is mailed and the reset still happens', async () => {
  const original = Deno.env.get('TEMPLATES_BACKEND')
  Deno.env.delete('TEMPLATES_BACKEND')
  try {
    const w = world()
    await w.totp.resetTotp('maria', 'Lost phone')
    assertEquals(w.state.emails.length, 0)
    assertEquals(
      (w.account('maria') as NonNullable<ReturnType<typeof w.account>>).totpSecret,
      undefined,
    )
  } finally {
    if (original !== undefined) Deno.env.set('TEMPLATES_BACKEND', original)
  }
})

Deno.test('reset: is audited with operator, target, reason and the before and after, never the email', async () => {
  const w = world()
  await w.totp.resetTotp('maria', 'Lost phone, identity checked')
  const [event] = w.events('totp.reset')
  assertEquals([event.result, event.actor, event.actorType], ['ok', 'operator', 'user'])
  assertEquals(event.target, { kind: 'account', id: 'maria' })
  assertEquals(event.request, { reason: 'Lost phone, identity checked' })
  assertEquals(event.before, { totpEnabled: true, backupCodesRemaining: 7 })
  assertEquals(event.after, { totpEnabled: false, backupCodesRemaining: 0 })
  assertFalse(JSON.stringify(w.state.audit).includes('totp-reset.invalid'))
})

Deno.test('reset: needs totp-reset; a caller without it is denied and the attempt is audited', async () => {
  for (const scope of [[RBAC_PERMISSIONS.roleWrite], [RBAC_PERMISSIONS.userWrite], []]) {
    const w = world({ session: { subject: 'other', scope } })
    // deno-lint-ignore no-await-in-loop
    const error = await rejection(() => w.totp.resetTotp('maria', 'Lost phone'))
    assertEquals([error.status.value, error.code], [403, IAM_ERROR_CODES.actorLacksPermission])
    assertEquals(error.meta, { required: RBAC_PERMISSIONS.totpReset })
    assertEquals(w.events('totp.reset')[0].result, 'denied')
    assertEquals(w.state.authUpdates.length, 0)
  }
})

Deno.test('reset: the superadmin wildcard is enough', async () => {
  const w = world({ session: { subject: 'root', scope: ['*'] } })
  await w.totp.resetTotp('maria', 'Lost phone')
  assertEquals(
    (w.account('maria') as NonNullable<ReturnType<typeof w.account>>).totpSecret,
    undefined,
  )
})

Deno.test('reset: a service credential is refused whatever scope it carries', async () => {
  const w = world({ session: { subject: 'svc', type: 'api', scope: ['*'] } })
  const error = await rejection(() => w.totp.resetTotp('maria', 'Lost phone'))
  assertEquals([error.status.value, error.code], [403, IAM_ERROR_CODES.actorNotAccount])
  assertEquals(w.state.authUpdates.length, 0)
})

Deno.test('reset: an operator cannot reset their own account', async () => {
  const w = world({
    roles: [role('role-reset', [perm(RBAC_PERMISSIONS.totpReset)])],
    accounts: [{
      id: 'operator',
      userId: 'user-operator',
      roleIds: ['role-reset'],
      email: 'operator@totp-reset.invalid',
      twoFactorAuthConfig: TOTP_CONFIG,
      totpSecret: true,
    }],
    profiles: { 'user-operator': 'ACTIVE' },
  })
  const error = await rejection(() => w.totp.resetTotp('operator', 'Lost phone'))
  assertEquals([error.status.value, error.code], [403, IAM_ERROR_CODES.totpResetSelf])
  assertEquals(w.state.authUpdates.length, 0)
  assertEquals(w.events('totp.reset')[0].result, 'denied')
})

Deno.test('reset: an account without an authenticator app is a clear 409 and a no-op', async () => {
  const w = world()
  for (const id of ['plain', 'by-email']) {
    // deno-lint-ignore no-await-in-loop
    const error = await rejection(() => w.totp.resetTotp(id, 'Lost phone'))
    assertEquals([error.status.value, error.code], [409, IAM_ERROR_CODES.totpNotEnabled])
  }
  assertEquals(w.state.authUpdates.length, 0)
  assertEquals(w.state.emails.length, 0)
  assertEquals(w.events('totp.reset').map((event) => event.result), ['conflict', 'conflict'])
  assertEquals(
    (w.account('by-email') as NonNullable<ReturnType<typeof w.account>>).twoFactorAuthConfig
      ?.method,
    'email',
  )
})

Deno.test('reset: running it twice, the second answers 409 and does not mail again', async () => {
  await withTemplates(async () => {
    const w = world()
    await w.totp.resetTotp('maria', 'Lost phone')
    const error = await rejection(() => w.totp.resetTotp('maria', 'Lost phone'))
    assertEquals(error.status.value, 409)
    assertEquals(w.state.emails.length, 1)
  })
})

Deno.test('reset: an unknown account is a 404', async () => {
  const w = world()
  const error = await rejection(() => w.totp.resetTotp('nobody', 'Lost phone'))
  assertEquals(error.status.value, 404)
})

Deno.test('reset: the audit fails closed, nothing is reset if the trail is down', async () => {
  const w = world({ failAudit: true })
  await rejection(() => w.totp.resetTotp('maria', 'Lost phone'))
  assertEquals(w.state.authUpdates.length, 0)
})

Deno.test('listResets: asks the audit trail for totp.reset only, optionally one account', () => {
  const w = world()
  const page = w.totp.listResets({ authId: 'maria', page: 2, limit: 5 }) as unknown as {
    options: Record<string, unknown>
  }
  assertEquals(page.options, { action: 'totp.reset', targetId: 'maria', page: 2, limit: 5 })
})

Deno.test('TotpResetRTO: reason is trimmed, 1 to 200 characters, no control characters', async () => {
  const ok = await validate(TotpResetRTO, { authId: 'a'.repeat(24), reason: '  Lost phone  ' })
  assertEquals(ok.reason, 'Lost phone')
  assertEquals(
    (await validate(TotpResetRTO, { authId: 'a'.repeat(24), reason: 'x'.repeat(200) })).reason
      .length,
    200,
  )
  for (
    const reason of ['', '   ', 'x'.repeat(201), 'bad\u0000reason', 'line\nbreak', 'zero​width']
  ) {
    // deno-lint-ignore no-await-in-loop
    await assertInvalid(TotpResetRTO, { authId: 'a'.repeat(24), reason }, ['reason'])
  }
  await assertInvalid(TotpResetRTO, { authId: 'not-an-id', reason: 'Lost phone' }, ['authId'])
  await assertInvalid(TotpResetRTO, { authId: 'a'.repeat(24) }, ['reason'])
})

Deno.test('SearchTotpResetsRTO: authId is optional and must be an id', async () => {
  await validate(SearchTotpResetsRTO, {})
  await validate(SearchTotpResetsRTO, { authId: 'a'.repeat(24) })
  await assertInvalid(SearchTotpResetsRTO, { authId: 'nope' }, ['authId'])
})
