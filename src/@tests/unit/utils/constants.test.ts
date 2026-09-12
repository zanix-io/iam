import { assertEquals, assertMatch, assertThrows } from 'jsr:@std/assert@0.224'
import {
  ACCESS_TOKEN_EXPIRATION_ENV,
  computeTokenExpiration,
  COOKIE_CONSENT_ENABLED_ENV,
  isCookieConsentEnabled,
  MESSAGES_ENV,
  PERMISSION_REGEX,
  POST_LOGIN_REDIRECT_URL_ENV,
  postLoginRedirectUrl,
  RBAC_PERMISSIONS,
  REDIRECT_TO_PARAM,
  REFRESH_TOKEN_EXPIRATION_ENV,
  resolveConfiguredAccessExpiration,
  resolveConfiguredRefreshExpiration,
  resolveMessageOverrides,
  resolvePostLoginRedirect,
  resolveThemeOverrides,
  SERVICE_ID,
  SERVICE_ID_ENV,
  THEME_ENV,
  TOKEN_EXPIRATION,
  TRUSTED_REDIRECT_ORIGINS_ENV,
  withRedirectToParam,
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

/**
 * `SERVICE_ID`/`RBAC_PERMISSIONS`'s `PERMISSIONS_PREFIX` are computed once at module load (same
 * limitation `TOKEN_EXPIRATION`'s own tests above already document) — this test process never sets
 * `SERVICE_ID_ENV`, so what's exercised here is the real, current default path, not a simulated one.
 */
Deno.test("SERVICE_ID: defaults to 'zanix-iam' when unset", () => {
  assertEquals(Deno.env.get(SERVICE_ID_ENV), undefined)
  assertEquals(SERVICE_ID, 'zanix-iam')
})

Deno.test('SERVICE_ID: matches the same letters-and-hyphens charset PERMISSION_REGEX requires on each side of the colon', () => {
  assertMatch(SERVICE_ID, /^[A-Za-z-]+$/)
})

Deno.test('RBAC_PERMISSIONS: every entry is built from the current SERVICE_ID, not a stale literal', () => {
  for (const code of Object.values(RBAC_PERMISSIONS)) {
    assertEquals(code.startsWith(`${SERVICE_ID}:`), true)
  }
})

Deno.test('resolveThemeOverrides: undefined with nothing configured (the default)', () => {
  withEnv(THEME_ENV, undefined, () => {
    assertEquals(resolveThemeOverrides(), undefined)
  })
})

Deno.test('resolveThemeOverrides: parses a configured JSON object of token overrides', () => {
  withEnv(THEME_ENV, '{"--space-color-primary":"#16a34a"}', () => {
    assertEquals(resolveThemeOverrides(), { '--space-color-primary': '#16a34a' })
  })
})

Deno.test('resolveThemeOverrides: throws IAM_INVALID_THEME on malformed JSON, never applies a value halfway', () => {
  withEnv(THEME_ENV, '{not valid json', () => {
    assertThrows(() => resolveThemeOverrides(), Error, 'IAM_THEME must be valid JSON')
  })
})

Deno.test('resolveMessageOverrides: undefined with nothing configured (the default)', () => {
  withEnv(MESSAGES_ENV, undefined, () => {
    assertEquals(resolveMessageOverrides(), undefined)
  })
})

Deno.test('resolveMessageOverrides: parses a configured JSON object of catalog overrides', () => {
  withEnv(MESSAGES_ENV, '{"login/heading":"Bienvenido"}', () => {
    assertEquals(resolveMessageOverrides(), { 'login/heading': 'Bienvenido' })
  })
})

Deno.test('resolveMessageOverrides: throws IAM_INVALID_MESSAGES on malformed JSON, never applies a value halfway', () => {
  withEnv(MESSAGES_ENV, '{not valid json', () => {
    assertThrows(() => resolveMessageOverrides(), Error, 'IAM_MESSAGES must be valid JSON')
  })
})

Deno.test("postLoginRedirectUrl: defaults to '/' when unset", () => {
  withEnv(POST_LOGIN_REDIRECT_URL_ENV, undefined, () => {
    assertEquals(postLoginRedirectUrl(), '/')
  })
})

Deno.test('postLoginRedirectUrl: reflects a configured destination', () => {
  withEnv(POST_LOGIN_REDIRECT_URL_ENV, '/dashboard', () => {
    assertEquals(postLoginRedirectUrl(), '/dashboard')
  })
})

Deno.test(`resolvePostLoginRedirect: ${REDIRECT_TO_PARAM} wins over the configured default when present and safe`, () => {
  withEnv(POST_LOGIN_REDIRECT_URL_ENV, '/dashboard', () => {
    const url = new URL(`http://localhost/en/login?${REDIRECT_TO_PARAM}=%2Faccount%2Fsettings`)
    assertEquals(resolvePostLoginRedirect(url), '/account/settings')
  })
})

Deno.test('resolvePostLoginRedirect: falls back to the configured default with no redirect_to at all', () => {
  withEnv(POST_LOGIN_REDIRECT_URL_ENV, '/dashboard', () => {
    const url = new URL('http://localhost/en/login')
    assertEquals(resolvePostLoginRedirect(url), '/dashboard')
  })
})

Deno.test('resolvePostLoginRedirect: rejects an absolute-URL redirect_to (open-redirect guard), falls back to the default', () => {
  withEnv(POST_LOGIN_REDIRECT_URL_ENV, '/dashboard', () => {
    const url = new URL(
      `http://localhost/en/login?${REDIRECT_TO_PARAM}=${
        encodeURIComponent('https://attacker.example')
      }`,
    )
    assertEquals(resolvePostLoginRedirect(url), '/dashboard')
  })
})

Deno.test('resolvePostLoginRedirect: rejects a protocol-relative redirect_to (open-redirect guard), falls back to the default', () => {
  withEnv(POST_LOGIN_REDIRECT_URL_ENV, '/dashboard', () => {
    const url = new URL(
      `http://localhost/en/login?${REDIRECT_TO_PARAM}=${encodeURIComponent('//attacker.example')}`,
    )
    assertEquals(resolvePostLoginRedirect(url), '/dashboard')
  })
})

Deno.test('resolvePostLoginRedirect: an absolute redirect_to on TRUSTED_REDIRECT_ORIGINS wins over the configured default', () => {
  withEnv(POST_LOGIN_REDIRECT_URL_ENV, '/dashboard', () => {
    withEnv(TRUSTED_REDIRECT_ORIGINS_ENV, 'https://app.example.com', () => {
      const url = new URL(
        `http://localhost/en/login?${REDIRECT_TO_PARAM}=${
          encodeURIComponent('https://app.example.com/dashboard?tab=settings')
        }`,
      )
      assertEquals(resolvePostLoginRedirect(url), 'https://app.example.com/dashboard?tab=settings')
    })
  })
})

Deno.test('resolvePostLoginRedirect: TRUSTED_REDIRECT_ORIGINS parses multiple comma-separated, trimmed origins', () => {
  withEnv(POST_LOGIN_REDIRECT_URL_ENV, '/dashboard', () => {
    withEnv(TRUSTED_REDIRECT_ORIGINS_ENV, ' https://a.example.com , https://b.example.com', () => {
      const url = new URL(
        `http://localhost/en/login?${REDIRECT_TO_PARAM}=${
          encodeURIComponent('https://b.example.com/x')
        }`,
      )
      assertEquals(resolvePostLoginRedirect(url), 'https://b.example.com/x')
    })
  })
})

Deno.test('resolvePostLoginRedirect: an absolute redirect_to whose origin is NOT on the allowlist is still rejected, even with other origins configured', () => {
  withEnv(POST_LOGIN_REDIRECT_URL_ENV, '/dashboard', () => {
    withEnv(TRUSTED_REDIRECT_ORIGINS_ENV, 'https://app.example.com', () => {
      const url = new URL(
        `http://localhost/en/login?${REDIRECT_TO_PARAM}=${
          encodeURIComponent('https://attacker.example/dashboard')
        }`,
      )
      assertEquals(resolvePostLoginRedirect(url), '/dashboard')
    })
  })
})

Deno.test('resolvePostLoginRedirect: TRUSTED_REDIRECT_ORIGINS matches the origin exactly, a path prefix is not enough', () => {
  withEnv(POST_LOGIN_REDIRECT_URL_ENV, '/dashboard', () => {
    // Configuring an origin WITH a path is a misconfiguration this parses literally, never
    // matching any real `URL.origin` (which never includes a path) — fails safe, not open.
    withEnv(TRUSTED_REDIRECT_ORIGINS_ENV, 'https://app.example.com/allowed-path', () => {
      const url = new URL(
        `http://localhost/en/login?${REDIRECT_TO_PARAM}=${
          encodeURIComponent('https://app.example.com/anywhere')
        }`,
      )
      assertEquals(resolvePostLoginRedirect(url), '/dashboard')
    })
  })
})

Deno.test('withRedirectToParam: threads a trusted absolute redirect_to through unchanged', () => {
  withEnv(TRUSTED_REDIRECT_ORIGINS_ENV, 'https://app.example.com', () => {
    const url = new URL(
      `http://localhost/en/login?${REDIRECT_TO_PARAM}=${
        encodeURIComponent('https://app.example.com/dashboard')
      }`,
    )
    assertEquals(
      withRedirectToParam('/en/login/otp/jane%40example.com', url),
      `/en/login/otp/jane%40example.com?${REDIRECT_TO_PARAM}=${
        encodeURIComponent('https://app.example.com/dashboard')
      }`,
    )
  })
})

Deno.test('withRedirectToParam: appends a safe redirect_to onto a path with no existing query string', () => {
  const url = new URL(`http://localhost/en/login?${REDIRECT_TO_PARAM}=%2Faccount`)
  assertEquals(
    withRedirectToParam('/en/login/otp/jane%40example.com', url),
    `/en/login/otp/jane%40example.com?${REDIRECT_TO_PARAM}=%2Faccount`,
  )
})

Deno.test('withRedirectToParam: appends onto a path that already has a query string', () => {
  const url = new URL(`http://localhost/en/login?${REDIRECT_TO_PARAM}=%2Faccount`)
  assertEquals(
    withRedirectToParam('/en/login?error=invalid_credentials', url),
    `/en/login?error=invalid_credentials&${REDIRECT_TO_PARAM}=%2Faccount`,
  )
})

Deno.test('withRedirectToParam: a no-op when the given url carries no safe redirect_to', () => {
  const url = new URL('http://localhost/en/login')
  assertEquals(
    withRedirectToParam('/en/login/otp/jane%40example.com', url),
    '/en/login/otp/jane%40example.com',
  )
})
