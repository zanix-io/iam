import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'

import type {
  OAuthAuthorizeRTO,
  OAuthTokenExchangeRTO,
} from 'server/handlers/rtos/oauth-provider.ts'
import { OAuthProviderService } from 'server/interactors/oauth-provider.interactor.ts'
import { AuthService } from 'server/interactors/auth.interactor.ts'
import { OAUTH_PROVIDER_CLIENTS_ENV } from 'utils/oauth-provider.ts'
import { mapGetter, mockAccessor } from '../../helpers/mock.ts'

/**
 * Pure, fast-fail validation coverage for `OAuthProviderService` — every branch here rejects (or
 * redirects) before any real JWT/blocklist machinery ever runs, so no `JWT_KEY_ENV`/real crypto
 * setup is needed. The real end-to-end code-issuance/exchange round trip (genuine JWT signing,
 * verification, and single-use blocklisting) lives in
 * `integration/server/interactors/oauth-provider.service.test.ts` instead — per
 * `zanix-test-tier-conventions`, that's "multiple real parts interacting", not a single isolated
 * unit.
 */

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

function buildService() {
  const service = new OAuthProviderService('ctx-1')
  mockAccessor(service, 'cache', { local: { get: () => undefined, set: () => {} } })
  mockAccessor(
    service,
    'interactors',
    mapGetter([[AuthService, { issueSessionForSubject: () => ({}) }]]),
  )
  // No cookie at all — `deriveSessionToken` fails on presence alone, before any signature
  // verification, so this needs no `JWT_KEY_ENV` to reach a deterministic "unauthenticated" result.
  mockAccessor(service, 'context', { cookies: {}, locals: { session: {} } })
  return service
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
    code: 'irrelevant-for-these-checks',
    client_id: CLIENT.clientId,
    client_secret: CLIENT.clientSecret,
    redirect_uri: CLIENT.redirectUris[0],
    ...overrides,
  }) as OAuthTokenExchangeRTO

Deno.test('authorize: no registered clients at all rejects with BAD_REQUEST', async () => {
  await withEnv(OAUTH_PROVIDER_CLIENTS_ENV, undefined, async () => {
    const service = buildService()
    await assertRejects(
      () => service.authorize(authorizeQuery()),
      HttpError,
      'Unknown OAuth2 client.',
    )
  })
})

Deno.test('authorize: an unknown client_id rejects with BAD_REQUEST', async () => {
  await withEnv(OAUTH_PROVIDER_CLIENTS_ENV, JSON.stringify([CLIENT]), async () => {
    const service = buildService()
    await assertRejects(
      () => service.authorize(authorizeQuery({ client_id: 'nobody' })),
      HttpError,
      'Unknown OAuth2 client.',
    )
  })
})

Deno.test("authorize: a redirect_uri outside the client's own allowlist rejects with FORBIDDEN", async () => {
  await withEnv(OAUTH_PROVIDER_CLIENTS_ENV, JSON.stringify([CLIENT]), async () => {
    const service = buildService()
    await assertRejects(
      () =>
        service.authorize(authorizeQuery({ redirect_uri: 'https://attacker.example/callback' })),
      HttpError,
      'redirect_uri is not registered for this client.',
    )
  })
})

Deno.test('authorize: redirect_uri is validated BEFORE session detection — never redirects on a bad one', async () => {
  await withEnv(OAUTH_PROVIDER_CLIENTS_ENV, JSON.stringify([CLIENT]), async () => {
    const service = buildService()
    // No session cookie is present either — if this validation ran AFTER session detection, the
    // (wrong) result would be a redirect to the login page instead of a thrown error.
    const error = await assertRejects(
      () =>
        service.authorize(authorizeQuery({ redirect_uri: 'https://attacker.example/callback' })),
      HttpError,
    )
    assertEquals(error.status.code, 'FORBIDDEN')
  })
})

Deno.test('authorize: unauthenticated (no session cookie) redirects to the hosted login page', async () => {
  await withEnv(OAUTH_PROVIDER_CLIENTS_ENV, JSON.stringify([CLIENT]), async () => {
    const service = buildService()
    const response = await service.authorize(authorizeQuery())
    assertEquals(response.status, 302)
    assertEquals(response.headers.get('location')?.startsWith('/en/login?redirect_to='), true)
  })
})

Deno.test('token: an unknown client_id rejects with BAD_REQUEST', async () => {
  await withEnv(OAUTH_PROVIDER_CLIENTS_ENV, JSON.stringify([CLIENT]), async () => {
    const service = buildService()
    await assertRejects(
      () => service.exchangeCode(tokenBody({ client_id: 'nobody' })),
      HttpError,
      'Invalid client credentials.',
    )
  })
})

Deno.test('token: a wrong client_secret rejects with BAD_REQUEST', async () => {
  await withEnv(OAUTH_PROVIDER_CLIENTS_ENV, JSON.stringify([CLIENT]), async () => {
    const service = buildService()
    await assertRejects(
      () => service.exchangeCode(tokenBody({ client_secret: 'wrong-secret' })),
      HttpError,
      'Invalid client credentials.',
    )
  })
})

Deno.test("token: a redirect_uri outside the client's own allowlist rejects with FORBIDDEN", async () => {
  await withEnv(OAUTH_PROVIDER_CLIENTS_ENV, JSON.stringify([CLIENT]), async () => {
    const service = buildService()
    await assertRejects(
      () => service.exchangeCode(tokenBody({ redirect_uri: 'https://attacker.example/callback' })),
      HttpError,
      'redirect_uri is not registered for this client.',
    )
  })
})

Deno.test('token: client credentials are checked BEFORE the code is even verified', async () => {
  await withEnv(OAUTH_PROVIDER_CLIENTS_ENV, JSON.stringify([CLIENT]), async () => {
    const service = buildService()
    // `code` is a syntactically-invalid string — if credential validation ran AFTER code
    // verification, this would surface as the code-verification error instead.
    const error = await assertRejects(
      () => service.exchangeCode(tokenBody({ client_secret: 'wrong-secret', code: 'garbage' })),
      HttpError,
    )
    assertEquals(error.message, 'Invalid client credentials.')
  })
})
