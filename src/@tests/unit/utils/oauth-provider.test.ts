import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'
import { JWT_KEY_ENV } from '@zanix/auth'

import {
  findOAuthProviderClient,
  isRegisteredRedirectUri,
  mintAuthorizationCode,
  OAUTH_PROVIDER_CLIENTS_ENV,
  type OAuthProviderClient,
  resolveOAuthProviderClients,
  timingSafeStringEqual,
  verifyAuthorizationCode,
} from 'utils/oauth-provider.ts'

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

const testClient: OAuthProviderClient = {
  clientId: 'host-a',
  clientSecret: 'super-secret',
  redirectUris: ['https://host-a.example.com/callback'],
}

Deno.test('resolveOAuthProviderClients: [] when unset — never a boot-time failure', async () => {
  await withEnv(OAUTH_PROVIDER_CLIENTS_ENV, undefined, () => {
    assertEquals(resolveOAuthProviderClients(), [])
  })
})

Deno.test('resolveOAuthProviderClients: parses a configured JSON client list', async () => {
  await withEnv(OAUTH_PROVIDER_CLIENTS_ENV, JSON.stringify([testClient]), () => {
    assertEquals(resolveOAuthProviderClients(), [testClient])
  })
})

Deno.test('resolveOAuthProviderClients: throws IAM_INVALID_OAUTH_PROVIDER_CLIENTS on malformed JSON', async () => {
  await withEnv(OAUTH_PROVIDER_CLIENTS_ENV, '{not valid json', () => {
    assertThrows(
      () => resolveOAuthProviderClients(),
      Error,
      'OAUTH_PROVIDER_CLIENTS must be valid JSON',
    )
  })
})

Deno.test('findOAuthProviderClient: finds a registered client by clientId', async () => {
  await withEnv(OAUTH_PROVIDER_CLIENTS_ENV, JSON.stringify([testClient]), () => {
    assertEquals(findOAuthProviderClient('host-a'), testClient)
  })
})

Deno.test('findOAuthProviderClient: undefined for an unregistered clientId', async () => {
  await withEnv(OAUTH_PROVIDER_CLIENTS_ENV, JSON.stringify([testClient]), () => {
    assertEquals(findOAuthProviderClient('unknown'), undefined)
  })
})

Deno.test('isRegisteredRedirectUri: exact match only — a prefix/sub-path never qualifies', () => {
  assert(isRegisteredRedirectUri(testClient, 'https://host-a.example.com/callback'))
  assert(!isRegisteredRedirectUri(testClient, 'https://host-a.example.com/callback/extra'))
  assert(!isRegisteredRedirectUri(testClient, 'https://host-a.example.com/'))
  assert(!isRegisteredRedirectUri(testClient, 'https://attacker.example.com/callback'))
})

Deno.test('timingSafeStringEqual: equal strings compare equal', () => {
  assert(timingSafeStringEqual('same-secret', 'same-secret'))
})

Deno.test('timingSafeStringEqual: different strings of the same length compare unequal', () => {
  assert(!timingSafeStringEqual('secret-aaaa', 'secret-bbbb'))
})

Deno.test('timingSafeStringEqual: different lengths compare unequal', () => {
  assert(!timingSafeStringEqual('short', 'a-much-longer-value'))
})

Deno.test('mintAuthorizationCode/verifyAuthorizationCode: round-trips the same claims', async () => {
  await withEnv(JWT_KEY_ENV, 'test-jwt-key', async () => {
    const code = await mintAuthorizationCode({
      sub: 'auth-1',
      clientId: 'host-a',
      redirectUri: 'https://host-a.example.com/callback',
    })
    const claims = await verifyAuthorizationCode(code)
    assertEquals(claims.sub, 'auth-1')
    assertEquals(claims.clientId, 'host-a')
    assertEquals(claims.redirectUri, 'https://host-a.example.com/callback')
    assert(claims.jti, 'a minted code always carries a jti')
  })
})

Deno.test('verifyAuthorizationCode: rejects a tampered/invalid code as FORBIDDEN', async () => {
  await withEnv(JWT_KEY_ENV, 'test-jwt-key', async () => {
    await assertRejects(
      () => verifyAuthorizationCode('not-a-real-code'),
      HttpError,
      'Invalid or expired authorization code.',
    )
  })
})

Deno.test('verifyAuthorizationCode: rejects a code signed with a different secret', async () => {
  const code = await withEnv(JWT_KEY_ENV, 'key-a', () =>
    mintAuthorizationCode({
      sub: 'auth-1',
      clientId: 'host-a',
      redirectUri: 'https://host-a.example.com/callback',
    }))

  await withEnv(JWT_KEY_ENV, 'key-b', async () => {
    await assertRejects(
      () => verifyAuthorizationCode(code),
      HttpError,
      'Invalid or expired authorization code.',
    )
  })
})

Deno.test('verifyAuthorizationCode: rejects an already-expired code', async () => {
  await withEnv(JWT_KEY_ENV, 'test-jwt-key', async () => {
    // A real, already-elapsed `exp` claim set directly (bypassing `createJWT`'s own `expiration`
    // option, which rejects a non-positive duration outright) — `verifyJWT`'s real expiration check
    // then rejects this deterministically, with no need to wait out a real clock.
    const { createJWT } = await import('@zanix/auth')
    const expiredCode = await createJWT(
      {
        sub: 'auth-1',
        clientId: 'host-a',
        redirectUri: 'https://host-a.example.com/callback',
        aud: 'iam:oauth-code',
        exp: Math.floor(Date.now() / 1000) - 10,
      },
      'test-jwt-key',
    )
    await assertRejects(
      () => verifyAuthorizationCode(expiredCode),
      HttpError,
      'Invalid or expired authorization code.',
    )
  })
})
