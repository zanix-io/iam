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
