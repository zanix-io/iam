import { assertEquals } from 'jsr:@std/assert@0.224'

import { UsersClient } from '../../../sdk/client/users.client.ts'
import { withMockFetch } from './fetch-mock.ts'

const BASE_URL = 'https://iam.example.com'
const TOKEN = 'access-token-value'

Deno.test("UsersClient.deactivateOwnAccount: patches users/deactivate with the caller's bearer token", async () => {
  await withMockFetch(
    [{ status: 200, body: { response: 'account deactivated' } }],
    async (calls) => {
      const result = await new UsersClient({ baseUrl: BASE_URL }).deactivateOwnAccount(TOKEN)
      assertEquals([calls[0].method, calls[0].url], ['PATCH', `${BASE_URL}/users/deactivate`])
      assertEquals(calls[0].headers.get('Authorization'), `Bearer ${TOKEN}`)
      assertEquals(result.response, 'account deactivated')
    },
  )
})

Deno.test("UsersClient.deleteOwnAccount: deletes users with the caller's bearer token", async () => {
  await withMockFetch([{ status: 200, body: { response: 'account deleted' } }], async (calls) => {
    await new UsersClient({ baseUrl: BASE_URL }).deleteOwnAccount(TOKEN)
    assertEquals([calls[0].method, calls[0].url], ['DELETE', `${BASE_URL}/users`])
    assertEquals(calls[0].headers.get('Authorization'), `Bearer ${TOKEN}`)
  })
})
