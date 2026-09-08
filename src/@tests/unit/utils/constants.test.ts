import { assertEquals, assertMatch } from 'jsr:@std/assert@0.224'
import {
  ACCESS_TOKEN_EXPIRATION_ENV,
  computeTokenExpiration,
  COOKIE_CONSENT_ENABLED_ENV,
  isCookieConsentEnabled,
  PERMISSION_REGEX,
  RBAC_PERMISSIONS,
  REFRESH_TOKEN_EXPIRATION_ENV,
  resolveConfiguredAccessExpiration,
  resolveConfiguredRefreshExpiration,
  TOKEN_EXPIRATION,
} from 'utils/constants.ts'

function withEnv(name: string, value: string | undefined, run: () => void) {
  const original = Deno.env.get(name)
  if (value === undefined) Deno.env.delete(name)
  else Deno.env.set(name, value)
  try {
    run()
  } finally {
    if (original === undefined) Deno.env.delete(name)
    else Deno.env.set(name, original)
  }
}

function withCookieConsentEnv(value: string | undefined, run: () => void) {
  const original = Deno.env.get(COOKIE_CONSENT_ENABLED_ENV)
  if (value === undefined) Deno.env.delete(COOKIE_CONSENT_ENABLED_ENV)
  else Deno.env.set(COOKIE_CONSENT_ENABLED_ENV, value)
  try {
    run()
  } finally {
    if (original === undefined) Deno.env.delete(COOKIE_CONSENT_ENABLED_ENV)
    else Deno.env.set(COOKIE_CONSENT_ENABLED_ENV, original)
  }
}

Deno.test('isCookieConsentEnabled: true with nothing configured (the default)', () => {
  withCookieConsentEnv(undefined, () => {
    assertEquals(isCookieConsentEnabled(), true)
  })
})

Deno.test("isCookieConsentEnabled: false only for the exact literal 'false'", () => {
  withCookieConsentEnv('false', () => {
    assertEquals(isCookieConsentEnabled(), false)
  })
})

Deno.test('isCookieConsentEnabled: true for any other value, including a typo', () => {
  withCookieConsentEnv('False', () => {
    assertEquals(isCookieConsentEnabled(), true)
  })
})

/**
 * Pure-data coverage for `RBAC_PERMISSIONS` — a real, isolated check (`unit/`-tier per
 * `zanix-test-tier-conventions`), not the guard-enforcement behavior itself. Whether
 * `@AuthTokenValidation({ permissions: RBAC_PERMISSIONS.* })` actually rejects/allows a request
 * per these values is verified live (`@zanix/server` ships no testing helpers for asserting a
 * decorator's applied guard config, and no controller in this project has ever unit-tested that —
 * see `UsersController`'s own report for the live re-verification this project relies on instead).
 * What IS worth guarding here, cheaply: every catalog entry is well-formed and collision-free —
 * exactly the kind of typo (a stray underscore, a duplicate code reused across two domains) that
 * would otherwise only surface once `IsPermission`/`PERMISSION_REGEX` rejects it at seed/runtime.
 */

Deno.test('RBAC_PERMISSIONS: every entry matches the required module:action shape', () => {
  for (const [key, code] of Object.entries(RBAC_PERMISSIONS)) {
    assertMatch(code, PERMISSION_REGEX, `${key} (${code}) must match PERMISSION_REGEX`)
  }
})

Deno.test('RBAC_PERMISSIONS: every entry is unique, no code shared across two keys', () => {
  const codes = Object.values(RBAC_PERMISSIONS)
  assertEquals(codes.length, new Set(codes).size)
})

Deno.test('RBAC_PERMISSIONS: userRead/userWrite exist, distinct from every other domain', () => {
  assertEquals(RBAC_PERMISSIONS.userRead, 'zanix-iam:user-read')
  assertEquals(RBAC_PERMISSIONS.userWrite, 'zanix-iam:user-write')
})

/**
 * `computeTokenExpiration` is the pure function {@linkcode TOKEN_EXPIRATION} itself is built from
 * (see that constant's own doc) — exercised directly here rather than through env-var mutation,
 * since `TOKEN_EXPIRATION` is a module-load-time constant that a later `Deno.env.set` can't retroactively
 * change within the same test run.
 */
Deno.test('computeTokenExpiration: with nothing configured, uses the @zanix/auth 1h default', () => {
  assertEquals(computeTokenExpiration(undefined), 60 * 60 - 10)
})

Deno.test('computeTokenExpiration: with a configured unit-suffixed duration, uses it', () => {
  assertEquals(computeTokenExpiration('30m'), 30 * 60 - 10)
})

Deno.test('computeTokenExpiration: a bare-number value is treated as seconds, matching the parseTTL numeric-input contract (never minutes)', () => {
  assertEquals(computeTokenExpiration(1800), 1800 - 10)
})

Deno.test('TOKEN_EXPIRATION: matches computeTokenExpiration(resolveConfiguredAccessExpiration()) at module load', () => {
  assertEquals(TOKEN_EXPIRATION, computeTokenExpiration(resolveConfiguredAccessExpiration()))
})

Deno.test('resolveConfiguredAccessExpiration: undefined with nothing configured (the default)', () => {
  withEnv(ACCESS_TOKEN_EXPIRATION_ENV, undefined, () => {
    assertEquals(resolveConfiguredAccessExpiration(), undefined)
  })
})

Deno.test('resolveConfiguredAccessExpiration: a unit-suffixed value is passed through as a string', () => {
  withEnv(ACCESS_TOKEN_EXPIRATION_ENV, '45m', () => {
    assertEquals(resolveConfiguredAccessExpiration(), '45m')
  })
})

Deno.test('resolveConfiguredAccessExpiration: a bare digit string is coerced into a real number, so parseTTL treats it as already-in-seconds instead of rejecting a unit-less duration', () => {
  withEnv(ACCESS_TOKEN_EXPIRATION_ENV, '1800', () => {
    assertEquals(resolveConfiguredAccessExpiration(), 1800)
  })
})

Deno.test('resolveConfiguredRefreshExpiration: undefined with nothing configured (the default)', () => {
  withEnv(REFRESH_TOKEN_EXPIRATION_ENV, undefined, () => {
    assertEquals(resolveConfiguredRefreshExpiration(), undefined)
  })
})

Deno.test('resolveConfiguredRefreshExpiration: a unit-suffixed value is passed through as a string', () => {
  withEnv(REFRESH_TOKEN_EXPIRATION_ENV, '30d', () => {
    assertEquals(resolveConfiguredRefreshExpiration(), '30d')
  })
})
