import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'

import {
  AccountContactService,
  MAX_CONTACT_EMAIL_BATCH,
} from 'server/interactors/account-contact.interactor.ts'
import { AuthRepository } from 'server/repositories/auth/entity.provider.ts'
import { UsersRepository } from 'server/repositories/users/entity.provider.ts'
import { blocksSignIn } from 'utils/constants.ts'
import { mapGetter, mockAccessor } from '../../helpers/mock.ts'

const ACCOUNTS = [
  { id: 'a1', userId: 'u1', email: 'one@contact-test.invalid' },
  { id: 'a2', userId: 'u2', email: 'two@contact-test.invalid' },
  { id: 'a3', userId: 'u3', email: 'closed@contact-test.invalid' },
  { id: 'a4', userId: undefined, email: 'orphan@contact-test.invalid' },
]
const STATUS: Record<string, string> = { u1: 'ACTIVE', u2: 'ACTIVE', u3: 'DELETED' }

function service() {
  const reads: string[][] = []
  const instance = new AccountContactService()
  mockAccessor(
    instance,
    'providers',
    mapGetter([
      [AuthRepository, {
        findContactEmails: (ids: string[]) => {
          reads.push(ids)
          return ACCOUNTS.filter((account) => ids.includes(account.id))
        },
      }],
      [UsersRepository, {
        findSignInBlockedIds: (ids: string[]) =>
          new Set(ids.filter((id) => id in STATUS && blocksSignIn(STATUS[id]))),
      }],
    ]),
  )
  return { instance, reads }
}

Deno.test('resolveEmails: answers the address of each active account, keyed by account id', async () => {
  const { instance } = service()
  assertEquals(await instance.resolveEmails(['a1', 'a2']), {
    a1: 'one@contact-test.invalid',
    a2: 'two@contact-test.invalid',
  })
})

Deno.test('resolveEmails: leaves out a closed account and an unknown one', async () => {
  const { instance } = service()
  assertEquals(await instance.resolveEmails(['a1', 'a3', 'nobody']), {
    a1: 'one@contact-test.invalid',
  })
})

Deno.test('resolveEmails: an account with no profile is still deliverable', async () => {
  const { instance } = service()
  assertEquals(await instance.resolveEmails(['a4']), { a4: 'orphan@contact-test.invalid' })
})

Deno.test('resolveEmails: reads each account once however often it is listed', async () => {
  const { instance, reads } = service()
  await instance.resolveEmails(['a1', 'a1', 'a2'])
  assertEquals(reads, [['a1', 'a2']])
})

Deno.test('resolveEmails: an empty list answers nothing', async () => {
  const { instance } = service()
  assertEquals(await instance.resolveEmails([]), {})
})

Deno.test('resolveEmails: refuses a payload that is not a list of ids', async () => {
  const { instance, reads } = service()
  const bad = [undefined, 'a1', { 0: 'a1' }, [1], [''], ['a1', null]]
  await Promise.all(
    bad.map((value) => assertRejects(() => instance.resolveEmails(value), Error, 'authIds')),
  )
  assertEquals(reads, [])
})

Deno.test('resolveEmails: refuses a list over the batch limit without reading', async () => {
  const { instance, reads } = service()
  const tooMany = Array.from({ length: MAX_CONTACT_EMAIL_BATCH + 1 }, (_, i) => `a${i}`)
  await assertRejects(() => instance.resolveEmails(tooMany), Error, 'At most')
  assertEquals(reads, [])
  const atLimit = tooMany.slice(0, MAX_CONTACT_EMAIL_BATCH)
  assertEquals(Object.keys(await instance.resolveEmails(atLimit)), ['a1', 'a2', 'a4'])
})
