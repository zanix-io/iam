import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'
import { SESSION_HEADERS } from '@zanix/server'
import { generateSessionTokens, JWT_KEY_ENV } from '@zanix/auth'

import type {
  OAuthAuthorizeRTO,
  OAuthTokenExchangeRTO,
} from 'server/handlers/rtos/oauth-provider.ts'
import { OAuthProviderService } from 'server/interactors/oauth-provider.interactor.ts'
import { AuthService } from 'server/interactors/auth.interactor.ts'
import { OAUTH_PROVIDER_CLIENTS_ENV } from 'utils/oauth-provider.ts'
import { mapGetter, mockAccessor } from '../../../unit/helpers/mock.ts'

/**
 * End-to-end coverage for the `oauth-provider` domain slice's real authorize→exchange flow —
 * genuinely REAL `@zanix/auth` JWT signing/verification and blocklist logic run throughout (per
 * `zanix-test-tier-conventions`, this is "multiple real parts interacting", not a single isolated
 * unit), with only the actual database-backed pieces (`AuthService`/its repositories) mocked out,
 * since those need a live Mongo connection this fast/isolated suite doesn't have. Pure validation
 * branches that need no real crypto at all (bad `client_id`, a `redirect_uri` mismatch) are covered
 * more cheaply in `unit/server/interactors/oauth-provider.service.test.ts` instead.
 */

const TEST_JWT_KEY = 'integration-test-jwt-key'
const CLIENT = {
  clientId: 'host-a',
  clientSecret: 'host-a-secret',
  redirectUris: ['https://host-a.example.com/callback'],
}

function withEnv<T>(
  name: string,
  value: string | undefined,
  run: () => Promise<T> | T,
): Promise<T> {
  const original = Deno.env.get(name)
  if (value === undefined) Deno.env.delete(name)
  else Deno.env.set(name, value)
  return (async () => {
    try {
      return await run()
    } finally {
      if (original === undefined) Deno.env.delete(name)
      else Deno.env.set(name, original)
    }
  })()
}

/** Reads `name` off `response`'s headers, asserting it's actually present — narrows `string | null`
 * to `string` without a non-null assertion, for every redirect-header check below. */
function requireHeader(response: Response, name: string): string {
  const value = response.headers.get(name)
  assert(value, `expected a "${name}" header to be present`)
  return value
}

/** Extracts the `code` query param from an `authorize()` redirect response — the real code this
 * test's own `exchangeCode` call goes on to redeem. */
function codeFrom(response: Response): string {
  const code = new URL(requireHeader(response, 'location')).searchParams.get('code')
  assert(code, 'a real code is present in the redirect')
  return code
}

/** A minimal, real-enough in-memory stand-in for `ZanixCacheProvider`'s own `local` connector —
 * `checkTokenBlockList`/`addTokenToBlockList` only ever touch `cache.local.get`/`.set` when
 * `REDIS_URI` isn't configured (never the case in this test suite), so this is the whole real
 * surface those functions need. */
function fakeCache() {
  const store = new Map<string, unknown>()
  return {
    local: {
      get: (key: string) => store.get(key),
      set: (key: string, value: unknown) => store.set(key, value),
    },
  }
}

const defaultAuthService = () => ({
  issueSessionForSubject: (subject: string) => ({
    accessToken: `access-for-${subject}`,
    refreshToken: `refresh-for-${subject}`,
    expiresAt: 12345,
  }),
})

function buildService(opts: { authService?: Partial<ReturnType<typeof defaultAuthService>> } = {}) {
  const authService = { ...defaultAuthService(), ...opts.authService }
  const cache = fakeCache()

  const service = new OAuthProviderService('ctx-1')
  mockAccessor(service, 'cache', cache)
  mockAccessor(service, 'interactors', mapGetter([[AuthService, authService]]))
  mockAccessor(service, 'context', { cookies: {}, locals: { session: {} } })

  return { service, authService, cache }
}

/** Mints a REAL, valid refresh-token cookie value for `subject` — the same
 * `generateSessionTokens` function `AuthService.finishLogin` mints session tokens through, called
 * directly here since this test isn't exercising `ZanixAuthProvider`/a live database. */
async function realRefreshTokenFor(subject: string): Promise<string> {
  const ctx = { locals: { session: {} } }
  // deno-lint-ignore no-explicit-any
  const { refreshToken } = await generateSessionTokens(ctx as any, { subject })
  return refreshToken
}

function authenticatedContext(refreshToken: string) {
  return {
    cookies: { [SESSION_HEADERS.user.token as string]: refreshToken },
    locals: { session: {} },
  }
}

const authorizeQuery = (overrides: Partial<OAuthAuthorizeRTO> = {}): OAuthAuthorizeRTO =>
  ({
    client_id: CLIENT.clientId,
    redirect_uri: CLIENT.redirectUris[0],
    response_type: 'code',
    state: 'xyz-state',
    ...overrides,
  }) as OAuthAuthorizeRTO

const tokenBody = (overrides: Partial<OAuthTokenExchangeRTO> = {}): OAuthTokenExchangeRTO =>
  ({
    grant_type: 'authorization_code',
    code: '',
    client_id: CLIENT.clientId,
    client_secret: CLIENT.clientSecret,
    redirect_uri: CLIENT.redirectUris[0],
    ...overrides,
  }) as OAuthTokenExchangeRTO

Deno.test('authorize: no session cookie redirects to the hosted login page, preserving every field', async () => {
  await withEnv(OAUTH_PROVIDER_CLIENTS_ENV, JSON.stringify([CLIENT]), async () => {
    const { service } = buildService()
    const response = await service.authorize(authorizeQuery())
    assertEquals(response.status, 302)
    const location = requireHeader(response, 'location')
    assert(location.startsWith('/en/login?redirect_to='))
    const returnTo = new URL(location, 'http://iam.internal').searchParams.get('redirect_to')
    assert(returnTo, 'a redirect_to param carrying the original request must be present')
    const returnToUrl = new URL(returnTo, 'http://iam.internal')
    assertEquals(returnToUrl.pathname, '/api/oauth/authorize')
    assertEquals(returnToUrl.searchParams.get('client_id'), CLIENT.clientId)
    assertEquals(returnToUrl.searchParams.get('redirect_uri'), CLIENT.redirectUris[0])
    assertEquals(returnToUrl.searchParams.get('state'), 'xyz-state')
  })
})

Deno.test('authorize + token: full happy path issues a code, then exchanges it for a real session', async () => {
  await withEnv(OAUTH_PROVIDER_CLIENTS_ENV, JSON.stringify([CLIENT]), async () => {
    await withEnv(JWT_KEY_ENV, TEST_JWT_KEY, async () => {
      const refreshToken = await realRefreshTokenFor('auth-1')
      const { service, authService } = buildService()
      mockAccessor(service, 'context', authenticatedContext(refreshToken))

      const authResponse = await service.authorize(authorizeQuery())
      assertEquals(authResponse.status, 302)
      const location = new URL(requireHeader(authResponse, 'location'))
      assertEquals(location.origin + location.pathname, CLIENT.redirectUris[0])
      // `state` is relayed back UNCHANGED — this project never inspects/verifies it (RFC 6749
      // §10.12: it's the requesting CLIENT's own CSRF token, not this authorization server's).
      assertEquals(location.searchParams.get('state'), 'xyz-state')
      const code = location.searchParams.get('code')
      assert(code, 'a real code is present in the redirect')

      const session = await service.exchangeCode(tokenBody({ code }))
      assertEquals(session, {
        accessToken: 'access-for-auth-1',
        refreshToken: 'refresh-for-auth-1',
        expiresAt: 12345,
      })
      void authService
    })
  })
})

Deno.test('authorize: unknown client_id is rejected before anything else runs', async () => {
  await withEnv(OAUTH_PROVIDER_CLIENTS_ENV, JSON.stringify([CLIENT]), async () => {
    const { service } = buildService()
    await assertRejects(
      () => service.authorize(authorizeQuery({ client_id: 'nobody' })),
      HttpError,
      'Unknown OAuth2 client.',
    )
  })
})

Deno.test('authorize: an unregistered redirect_uri is rejected, never redirected to', async () => {
  await withEnv(OAUTH_PROVIDER_CLIENTS_ENV, JSON.stringify([CLIENT]), async () => {
    const { service } = buildService()
    await assertRejects(
      () =>
        service.authorize(authorizeQuery({ redirect_uri: 'https://attacker.example/callback' })),
      HttpError,
      'redirect_uri is not registered for this client.',
    )
  })
})

Deno.test('token: invalid client_secret is rejected', async () => {
  await withEnv(OAUTH_PROVIDER_CLIENTS_ENV, JSON.stringify([CLIENT]), async () => {
    const { service } = buildService()
    await assertRejects(
      () => service.exchangeCode(tokenBody({ code: 'irrelevant', client_secret: 'wrong' })),
      HttpError,
      'Invalid client credentials.',
    )
  })
})

Deno.test('token: a redirect_uri not registered for the client is rejected', async () => {
  await withEnv(OAUTH_PROVIDER_CLIENTS_ENV, JSON.stringify([CLIENT]), async () => {
    const { service } = buildService()
    await assertRejects(
      () =>
        service.exchangeCode(
          tokenBody({ code: 'irrelevant', redirect_uri: 'https://attacker.example/callback' }),
        ),
      HttpError,
      'redirect_uri is not registered for this client.',
    )
  })
})

Deno.test('token: a code minted for a different client_id is rejected even though it verifies', async () => {
  await withEnv(
    OAUTH_PROVIDER_CLIENTS_ENV,
    JSON.stringify([CLIENT, { ...CLIENT, clientId: 'host-b', clientSecret: 'host-b-secret' }]),
    async () => {
      await withEnv(JWT_KEY_ENV, TEST_JWT_KEY, async () => {
        const refreshToken = await realRefreshTokenFor('auth-1')
        const { service } = buildService()
        mockAccessor(service, 'context', authenticatedContext(refreshToken))

        // Mint a code for `host-a`.
        const authResponse = await service.authorize(authorizeQuery({ client_id: 'host-a' }))
        const code = codeFrom(authResponse)

        // Attempt to redeem it as `host-b` — same redirect_uri, different registered client.
        await assertRejects(
          () =>
            service.exchangeCode(
              tokenBody({ code, client_id: 'host-b', client_secret: 'host-b-secret' }),
            ),
          HttpError,
          'Invalid or expired authorization code.',
        )
      })
    },
  )
})

Deno.test('token: a code can never be redeemed twice (single-use / replay protection)', async () => {
  await withEnv(OAUTH_PROVIDER_CLIENTS_ENV, JSON.stringify([CLIENT]), async () => {
    await withEnv(JWT_KEY_ENV, TEST_JWT_KEY, async () => {
      const refreshToken = await realRefreshTokenFor('auth-1')
      const { service } = buildService()
      mockAccessor(service, 'context', authenticatedContext(refreshToken))

      const authResponse = await service.authorize(authorizeQuery())
      const code = codeFrom(authResponse)

      const firstExchange = await service.exchangeCode(tokenBody({ code }))
      assert('accessToken' in firstExchange)

      await assertRejects(
        () => service.exchangeCode(tokenBody({ code })),
        HttpError,
        'Invalid or expired authorization code.',
      )
    })
  })
})
