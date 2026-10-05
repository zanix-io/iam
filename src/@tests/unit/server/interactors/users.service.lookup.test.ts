import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@0.224'

import { IAM_ERROR_CODES, RBAC_PERMISSIONS } from 'utils/constants.ts'
import { buildWorld, rejection, role } from '../../helpers/role-world.ts'

const EMAIL = 'maria.lopez@lookup-test.invalid'
const READER = { subject: 'reader', scope: [RBAC_PERMISSIONS.userRead] }

/** A world with a reader and the people the lookup can find. */
const world = (init: Parameters<typeof buildWorld>[0] = {}) =>
  buildWorld({
    roles: [role('role-user', [])],
    accounts: [
      { id: 'maria', userId: 'user-maria', roleIds: ['role-user'], email: EMAIL },
      { id: 'inactive', userId: 'user-inactive', email: 'inactive@lookup-test.invalid' },
      { id: 'deleted', userId: 'user-deleted', email: 'deleted@lookup-test.invalid' },
      { id: 'orphan', email: 'orphan@lookup-test.invalid' },
      { id: 'mixed', userId: 'user-mixed', email: 'Mixed.Case@lookup-test.invalid' },
    ],
    profiles: {
      'user-maria': 'ACTIVE',
      'user-inactive': 'INACTIVE',
      'user-deleted': 'DELETED',
      'user-mixed': 'ACTIVE',
    },
    session: READER,
    ...init,
  })

Deno.test('lookup: answers exactly the projection of the person, never the email', async () => {
  const w = world()
  const found = await w.users.lookupUserByEmail(EMAIL)
  assertEquals(found, {
    authId: 'maria',
    userId: 'user-maria',
    firstName: 'Name user-maria',
    lastName: undefined,
    status: 'ACTIVE',
    roleIds: ['role-user'],
  })
  assertEquals(Object.keys(found).sort(), [
    'authId',
    'firstName',
    'lastName',
    'roleIds',
    'status',
    'userId',
  ])
  assertFalse(JSON.stringify(found).includes('lookup-test'))
})

Deno.test('lookup: surrounding spaces and capitals are normalized, a stored mixed case is found too', async () => {
  const w = world()
  assertEquals((await w.users.lookupUserByEmail(`  ${EMAIL.toUpperCase()} `)).authId, 'maria')
  assertEquals((await w.users.lookupUserByEmail('Mixed.Case@lookup-test.invalid')).authId, 'mixed')
  // The address is stored under the spelling it was registered with: only that spelling (or, for
  // a lowercase registration, any capitalization of it) finds it.
  const error = await rejection(() => w.users.lookupUserByEmail('mixed.case@lookup-test.invalid'))
  assertEquals(error.code, IAM_ERROR_CODES.userNotFound)
})

Deno.test('lookup: an INACTIVE person is returned with its status', async () => {
  const found = await world().users.lookupUserByEmail('inactive@lookup-test.invalid')
  assertEquals(found.status, 'INACTIVE')
})

Deno.test('lookup: nothing partial matches', async () => {
  const w = world()
  for (const partial of ['maria.lopez@lookup-test.invali', 'aria.lopez@lookup-test.invalid']) {
    // deno-lint-ignore no-await-in-loop
    const error = await rejection(() => w.users.lookupUserByEmail(partial))
    assertEquals(error.status.value, 404)
  }
})

Deno.test('lookup: no account, no profile and a DELETED profile answer the same 404', async () => {
  const w = world()
  const errors = []
  for (
    const email of [
      'nobody@lookup-test.invalid',
      'orphan@lookup-test.invalid',
      'deleted@lookup-test.invalid',
    ]
  ) {
    // deno-lint-ignore no-await-in-loop
    errors.push(await rejection(() => w.users.lookupUserByEmail(email)))
  }
  for (const error of errors) {
    assertEquals(error.status.value, 404)
    assertEquals(error.code, IAM_ERROR_CODES.userNotFound)
    assertEquals(error.message, errors[0].message)
    assertEquals(error.meta, errors[0].meta)
  }
})

Deno.test('lookup: every call is audited without the email, with the person as target when found', async () => {
  const w = world()
  await w.users.lookupUserByEmail(EMAIL)
  await rejection(() => w.users.lookupUserByEmail('nobody@lookup-test.invalid'))
  const [hit, miss] = w.events('users.lookup')
  assertEquals([hit.result, hit.actor, hit.actorType], ['ok', 'reader', 'user'])
  assertEquals(hit.target, { kind: 'user', id: 'user-maria' })
  assertEquals([miss.result, miss.reason], ['not-found', IAM_ERROR_CODES.userNotFound])
  assertEquals(miss.target, { kind: 'user' })
  const trail = JSON.stringify(w.state.audit)
  assertFalse(trail.includes('lookup-test'), 'no email in the trail')
  assertFalse(trail.includes('maria.lopez'))
})

Deno.test('lookup: user-write is enough, and a caller without either is denied and audited', async () => {
  const writer = world({ session: { subject: 'writer', scope: [RBAC_PERMISSIONS.userWrite] } })
  assertEquals((await writer.users.lookupUserByEmail(EMAIL)).authId, 'maria')

  const none = world({ session: { subject: 'none', scope: ['web:user'] } })
  const error = await rejection(() => none.users.lookupUserByEmail(EMAIL))
  assertEquals([error.status.value, error.code], [403, IAM_ERROR_CODES.actorLacksPermission])
  assertEquals(error.meta, { required: [RBAC_PERMISSIONS.userRead, RBAC_PERMISSIONS.userWrite] })
  assertEquals(none.events('users.lookup')[0].result, 'denied')
})

Deno.test('lookup: a service credential is refused as ACTOR_NOT_ACCOUNT', async () => {
  const w = world({ session: { subject: 'svc', scope: ['*'], type: 'api' } })
  const error = await rejection(() => w.users.lookupUserByEmail(EMAIL))
  assertEquals([error.status.value, error.code], [403, IAM_ERROR_CODES.actorNotAccount])
})

Deno.test('lookup: a demoted operator (token says yes, database says no) is refused', async () => {
  const w = world()
  w.setRolesDirectly('reader', [])
  const error = await rejection(() => w.users.lookupUserByEmail(EMAIL))
  assertEquals(error.code, IAM_ERROR_CODES.actorLacksPermission)
})

Deno.test('lookup: an audit store that is down does not stop the read, and leaves no event', async () => {
  const w = world({ failAudit: true })
  assertEquals((await w.users.lookupUserByEmail(EMAIL)).authId, 'maria')
  assertEquals(w.state.audit.length, 0)
  const error = await rejection(() => w.users.lookupUserByEmail('nobody@lookup-test.invalid'))
  assertEquals(error.code, IAM_ERROR_CODES.userNotFound)
})

Deno.test('a change still fails closed when the audit store is down', async () => {
  const w = buildWorld({ failAudit: true, session: { subject: 'caller', scope: ['*'] } })
  const error = await rejection(() =>
    w.users.updateUserById('user-caller', { firstName: 'X' } as never)
  )
  assert(String((error as { cause?: Error }).cause ?? error).includes('audit store is down'))
  assertEquals(w.state.updatedUsers.length, 0)
})
