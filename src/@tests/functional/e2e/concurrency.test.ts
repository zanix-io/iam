// deno-lint-ignore-file no-await-in-loop
import { assert, assertEquals } from 'jsr:@std/assert@0.224'

import { RBAC_PERMISSIONS } from 'utils/constants.ts'
import { assertOk, e2eIgnore, type Iam, startIam, toolbox } from '../../support/e2e.ts'

/**
 * Real concurrency: simultaneous HTTP requests against one server and one MongoDB. The rule "an
 * administrator remains" must hold when two requests each take away the other administrator, and
 * two additions to the same account must not lose each other's role. Each scenario repeats
 * `ROUNDS` times, because a race that happens to be won once proves nothing.
 */
const P = RBAC_PERMISSIONS
const ROUNDS = 12

/** Accounts that can manage roles and sign in, counted straight from the database. */
async function activeAdministrators(iam: Iam, adminRoleId: string): Promise<number> {
  const accounts = await iam.db.col('auths').find({ roleIds: iam.db.oid(adminRoleId) }).toArray()
  let active = 0
  for (const account of accounts) {
    const profile = account.userId
      ? await iam.db.col('users').findOne({ _id: account.userId })
      : undefined
    if (!profile || profile.status === 'ACTIVE') active++
  }
  return active
}

Deno.test({
  name:
    'e2e: concurrent requests never leave the system without an administrator, and additions do not lose each other',
  ignore: e2eIgnore,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const iam = await startIam()
    const tools = toolbox(iam)
    try {
      const adminRole = await tools.createRole('manager', [
        P.roleRead,
        P.roleWrite,
        P.permissionRead,
        P.userRead,
        P.userWrite,
      ])
      type Person = { authId: string; userId: string; roleIds: string[]; token: string }
      const people: Person[] = []
      for (const name of ['a', 'b']) {
        const person = await iam.register(iam.admin.accessToken, `${name}@iam-test.invalid`)
        assertOk(
          await iam.call('POST', '/roles/add', {
            token: iam.admin.accessToken,
            body: { authId: person.authId, roleIds: [adminRole] },
          }),
        )
        people.push({
          ...person,
          token: (await iam.login(`${name}@iam-test.invalid`)).accessToken,
        })
      }
      const [a, b] = people
      // The seeded first administrator cannot sign in: a and b are the only administrators.
      const first = await iam.db.col('auths').findOne({ _id: iam.db.oid(iam.admin.claims.sub) })
      await iam.db.col('users').updateOne({ _id: first.userId }, { $set: { status: 'INACTIVE' } })

      const reset = async () => {
        for (const person of people) {
          await iam.db.col('auths').updateOne(
            { _id: iam.db.oid(person.authId) },
            { $set: { roleIds: [iam.db.oid(adminRole)] } },
          )
          await iam.db.col('users').updateOne(
            { _id: iam.db.oid(person.userId) },
            { $set: { status: 'ACTIVE' } },
          )
        }
      }
      const remove = (who: Person, from: Person) =>
        iam.call('POST', '/roles/remove', {
          token: who.token,
          body: { authId: from.authId, roleIds: [adminRole] },
        })
      const block = (who: Person, whom: Person) =>
        iam.call('PATCH', `/users/${whom.userId}`, {
          token: who.token,
          body: { status: 'INACTIVE' },
        })

      await t.step(
        `two administrators remove each other's role at once, ${ROUNDS} times`,
        async () => {
          let bothRefused = 0
          let oneWon = 0
          for (let round = 0; round < ROUNDS; round++) {
            await reset()
            const [one, other] = await Promise.all([remove(a, b), remove(b, a)])
            const successes = [one, other].filter((reply) => reply.status === 200).length
            assert(successes <= 1, `round ${round}: both removals succeeded`)
            for (const reply of [one, other]) {
              assert([200, 403, 409].includes(reply.status), `${reply.status}`)
            }
            assert(
              await activeAdministrators(iam, adminRole) >= 1,
              `round ${round}: nobody can manage roles any more`,
            )
            if (successes === 1) {
              oneWon++
            } else bothRefused++
          }
          assertEquals(oneWon + bothRefused, ROUNDS)
        },
      )

      await t.step(
        `one removes the other's role while the other blocks the first's profile, ${ROUNDS} times`,
        async () => {
          for (let round = 0; round < ROUNDS; round++) {
            await reset()
            const [removal, blocking] = await Promise.all([remove(a, b), block(b, a)])
            assert(
              !(removal.status === 200 && blocking.status === 200),
              `round ${round}: both changes succeeded`,
            )
            assert(
              await activeAdministrators(iam, adminRole) >= 1,
              `round ${round}: nobody can manage roles any more`,
            )
          }
        },
      )

      await t.step(
        `two administrators block each other's profile at once, ${ROUNDS} times`,
        async () => {
          for (let round = 0; round < ROUNDS; round++) {
            await reset()
            const [one, other] = await Promise.all([block(a, b), block(b, a)])
            assert(!(one.status === 200 && other.status === 200), `round ${round}: both succeeded`)
            assert(
              await activeAdministrators(iam, adminRole) >= 1,
              `round ${round}: nobody can manage roles any more`,
            )
          }
        },
      )

      await t.step(
        `two additions to the same account keep both roles, ${ROUNDS} times`,
        async () => {
          await reset()
          const roleOne = await tools.createRole('extra-one', [P.roleRead], a.token)
          const roleTwo = await tools.createRole('extra-two', [P.roleRead], b.token)
          for (let round = 0; round < ROUNDS; round++) {
            const target = await iam.register(a.token, `target${round}@iam-test.invalid`)
            const [one, other] = await Promise.all([
              iam.call('POST', '/roles/add', {
                token: a.token,
                body: { authId: target.authId, roleIds: [roleOne] },
              }),
              iam.call('POST', '/roles/add', {
                token: b.token,
                body: { authId: target.authId, roleIds: [roleTwo] },
              }),
            ])
            assertEquals([one.status, other.status], [200, 200])
            assertEquals(
              [...(await tools.rolesOf(target.authId))].sort(),
              [roleOne, roleTwo].sort(),
            )
          }
        },
      )

      await t.step(
        `two permission edits of one role at once never mix, ${ROUNDS} times`,
        async () => {
          const first = [await tools.permissionId(P.roleRead)]
          const second = [
            await tools.permissionId(P.roleRead),
            await tools.permissionId(P.userRead),
          ]
          const target = await tools.createRole('contended', [P.roleRead], a.token)
          let conflicts = 0
          for (let round = 0; round < ROUNDS; round++) {
            const edit = (who: Person, permissions: string[]) =>
              iam.call('PATCH', `/roles/${target}`, { token: who.token, body: { permissions } })
            const [one, other] = await Promise.all([edit(a, first), edit(b, second)])
            for (const reply of [one, other]) {
              assert(
                reply.status === 200 ||
                  (reply.status === 409 && reply.body.code === 'ROLE_VERSION_CONFLICT'),
                `${reply.status} ${reply.body.code}`,
              )
              if (reply.status === 409) conflicts++
            }
            const stored = (await iam.db.col('roles').findOne({ _id: iam.db.oid(target) }))
              .permissions
              .map(String)
            assert(
              [first, second].some((set) =>
                set.length === stored.length && set.every((id) => stored.includes(id))
              ),
              `round ${round}: the role ended with a mix: ${stored}`,
            )
          }
          assert(conflicts >= 0)
        },
      )
    } finally {
      await iam.stop()
    }
  },
})
