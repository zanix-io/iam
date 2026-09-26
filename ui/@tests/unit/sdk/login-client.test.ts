import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { RestClientError } from '@zanix/server'

import { LoginClient } from '../../../sdk/client/login.client.ts'
import { bodyJson, withMockFetch } from './fetch-mock.ts'

const BASE_URL = 'https://iam.example.com'

Deno.test('LoginClient.login: posts to login/login with the credentials as JSON', async () => {
  await withMockFetch(
    [{
      status: 200,
      body: { accessToken: 'a', refreshToken: 'r', expiresAt: 1, mustChangePassword: false },
    }],
    async (calls) => {
      const client = new LoginClient({ baseUrl: BASE_URL })
      const result = await client.login('user@example.com', 'secret1A')

      assertEquals(calls.length, 1)
      assertEquals(calls[0].method, 'POST')
      assertEquals(calls[0].url, `${BASE_URL}/login/login`)
      assertEquals(bodyJson(calls[0]), {
        email: 'user@example.com',
        password: 'secret1A',
      })
      assertEquals(result, {
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: 1,
        mustChangePassword: false,
      })
    },
  )
})

Deno.test('LoginClient.login: a 2FA-enabled account returns a challenge, not tokens', async () => {
  await withMockFetch(
    [{ status: 200, body: { message: 'Two-factor authentication is enabled.' } }],
    async () => {
      const client = new LoginClient({ baseUrl: BASE_URL })
      const result = await client.login('user@example.com', 'secret1A')
      assertEquals('accessToken' in result, false)
      assertEquals((result as { message: string }).message, 'Two-factor authentication is enabled.')
    },
  )
})

Deno.test('LoginClient.login: an invalid password surfaces as a RestClientError with the real upstream status', async () => {
  await withMockFetch([{ status: 403, body: undefined }], async () => {
    const client = new LoginClient({ baseUrl: BASE_URL })
    const error = await assertRejects(
      () => client.login('user@example.com', 'wrong'),
      RestClientError,
    )
    assertEquals(error.realHttpStatus, 403)
  })
})

Deno.test('LoginClient.oauthAuthorize: gets the provider authorize URL', async () => {
  await withMockFetch(
    [{ status: 200, body: { url: 'https://accounts.google.com/o/oauth2/auth', state: 'abc' } }],
    async (calls) => {
      const client = new LoginClient({ baseUrl: BASE_URL })
      const result = await client.oauthAuthorize('google')
      assertEquals(calls[0].method, 'GET')
      assertEquals(calls[0].url, `${BASE_URL}/login/google`)
      assertEquals(result.state, 'abc')
    },
  )
})

Deno.test('LoginClient.oauthCallback: posts the authorization code to the provider callback route', async () => {
  await withMockFetch(
    [{
      status: 200,
      body: { accessToken: 'a', refreshToken: 'r', expiresAt: 1, mustChangePassword: false },
    }],
    async (calls) => {
      const client = new LoginClient({ baseUrl: BASE_URL })
      await client.oauthCallback('github', 'auth-code')
      assertEquals(calls[0].url, `${BASE_URL}/login/github/callback`)
      assertEquals(bodyJson(calls[0]), { code: 'auth-code' })
    },
  )
})

Deno.test('LoginClient.refresh: posts the refresh token to login/refresh', async () => {
  await withMockFetch(
    [{ status: 200, body: { accessToken: 'a2', refreshToken: 'r2', expiresAt: 2 } }],
    async (calls) => {
      const client = new LoginClient({ baseUrl: BASE_URL })
      const result = await client.refresh('old-refresh-token')
      assertEquals(calls[0].url, `${BASE_URL}/login/refresh`)
      assertEquals(bodyJson(calls[0]), { token: 'old-refresh-token' })
      assertEquals(result.accessToken, 'a2')
    },
  )
})

Deno.test('LoginClient.refresh: also sends the token via X-Znx-App-Token, for per-identity rate limiting', async () => {
  await withMockFetch(
    [{ status: 200, body: { accessToken: 'a2', refreshToken: 'r2', expiresAt: 2 } }],
    async (calls) => {
      const client = new LoginClient({ baseUrl: BASE_URL })
      await client.refresh('old-refresh-token')
      assertEquals(calls[0].headers.get('X-Znx-App-Token'), 'old-refresh-token')
    },
  )
})

Deno.test('LoginClient.refresh: sends no X-Znx-App-Token header when no token is passed', async () => {
  await withMockFetch(
    [{ status: 200, body: { accessToken: 'a2', refreshToken: 'r2', expiresAt: 2 } }],
    async (calls) => {
      const client = new LoginClient({ baseUrl: BASE_URL })
      await client.refresh()
      assertEquals(calls[0].headers.get('X-Znx-App-Token'), null)
    },
  )
})

Deno.test('LoginClient.logout: sends the access token as a bearer header', async () => {
  await withMockFetch([{ status: 200, body: { response: 'token revoked' } }], async (calls) => {
    const client = new LoginClient({ baseUrl: BASE_URL })
    const result = await client.logout('access-token-value', 'refresh-token-value')
    assertEquals(calls[0].url, `${BASE_URL}/login/logout`)
    assertEquals(calls[0].headers.get('Authorization'), 'Bearer access-token-value')
    assertEquals(bodyJson(calls[0]), { token: 'refresh-token-value' })
    assertEquals(result.response, 'token revoked')
  })
})

Deno.test('LoginClient.confirmReactivation: posts the reactivation token to login/reactivate, unauthenticated', async () => {
  await withMockFetch(
    [{ status: 200, body: { accessToken: 'a', refreshToken: 'r', expiresAt: 1 } }],
    async (calls) => {
      const result = await new LoginClient({ baseUrl: BASE_URL }).confirmReactivation('react-1')
      assertEquals([calls[0].method, calls[0].url], ['POST', `${BASE_URL}/login/reactivate`])
      assertEquals(bodyJson(calls[0]), { reactivationToken: 'react-1' })
      assertEquals(calls[0].headers.get('Authorization'), null)
      assertEquals((result as { accessToken: string }).accessToken, 'a')
    },
  )
})

Deno.test("LoginClient.getOwnAuthMethods: gets login/methods with the caller's bearer token", async () => {
  await withMockFetch([{ status: 200, body: { hasPassword: true } }], async (calls) => {
    await new LoginClient({ baseUrl: BASE_URL }).getOwnAuthMethods('access-token-value')
    assertEquals([calls[0].method, calls[0].url], ['GET', `${BASE_URL}/login/methods`])
    assertEquals(calls[0].headers.get('Authorization'), 'Bearer access-token-value')
  })
})

Deno.test('LoginClient.getLoginMethods: gets login/methods/:email with the email URI-encoded, unauthenticated', async () => {
  await withMockFetch([{ status: 200, body: { hasPassword: false } }], async (calls) => {
    await new LoginClient({ baseUrl: BASE_URL }).getLoginMethods('user+tag@example.com')
    assertEquals(
      calls[0].url,
      `${BASE_URL}/login/methods/${encodeURIComponent('user+tag@example.com')}`,
    )
    assertEquals(calls[0].headers.get('Authorization'), null)
  })
})

Deno.test('LoginClient.linkOauth: posts the provider code to login/:provider/link with a bearer header', async () => {
  await withMockFetch([{ status: 200, body: { response: 'google connected' } }], async (calls) => {
    await new LoginClient({ baseUrl: BASE_URL }).linkOauth('access-token-value', 'google', 'code-1')
    assertEquals([calls[0].method, calls[0].url], ['POST', `${BASE_URL}/login/google/link`])
    assertEquals(bodyJson(calls[0]), { code: 'code-1' })
    assertEquals(calls[0].headers.get('Authorization'), 'Bearer access-token-value')
  })
})

Deno.test('LoginClient.unlinkOauth: deletes login/:provider with a bearer header', async () => {
  await withMockFetch(
    [{ status: 200, body: { response: 'github disconnected' } }],
    async (calls) => {
      await new LoginClient({ baseUrl: BASE_URL }).unlinkOauth('access-token-value', 'github')
      assertEquals([calls[0].method, calls[0].url], ['DELETE', `${BASE_URL}/login/github`])
      assertEquals(calls[0].headers.get('Authorization'), 'Bearer access-token-value')
    },
  )
})

Deno.test('LoginClient.oauthAuthorize: an email hint is sent URI-encoded as ?email=', async () => {
  await withMockFetch(
    [{ status: 200, body: { url: 'https://accounts.example', state: 's' } }],
    async (calls) => {
      await new LoginClient({ baseUrl: BASE_URL }).oauthAuthorize('google', 'user+tag@example.com')
      assertEquals(
        calls[0].url,
        `${BASE_URL}/login/google?email=${encodeURIComponent('user+tag@example.com')}`,
      )
    },
  )
})
