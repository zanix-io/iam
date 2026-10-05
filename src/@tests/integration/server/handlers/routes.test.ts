import { assert, assertEquals } from 'jsr:@std/assert@0.224'
import { createJWT, JWT_KEY_ENV } from '@zanix/auth'

import 'server/handlers/login.handler.ts'
import 'server/handlers/password.handler.ts'
import 'server/handlers/users.handler.ts'
import 'server/handlers/roles.handler.ts'
import 'server/handlers/audit.handler.ts'
import 'server/handlers/permissions.handler.ts'
import 'server/handlers/grant-access.handler.ts'
import 'server/handlers/oauth-provider.handler.ts'
import 'server/handlers/templates.handler.ts'
import {
  adminLookupRateLimit,
  adminMutationRateLimit,
  criticalRateLimit,
  freeRateLimit,
  loginMethodsRateLimit,
  RBAC_PERMISSIONS,
} from 'utils/constants.ts'
import {
  allowedBeforeLimit,
  type AnyGuard,
  fakeRateLimitCache,
  guardContext,
  guardKind,
  restRoutes,
} from '../../../unit/helpers/route-guards.ts'

/**
 * The REST surface as `@zanix/server` actually registered it from every controller's decorators:
 * paths, methods, request RTOs, guard order, per-route permissions and per-route rate limits.
 * Everything here reads the real route registry and runs the real registered guards (only the
 * `cache` provider behind `rateLimitGuard` is an in-memory stand-in), so a changed decorator in a
 * handler file fails here; a copy of the decorator's options inside a test would not.
 */

const routes = restRoutes()

const TOKEN_HEADER = 'X-Znx-App-Token'
const TEST_JWT_KEY = 'routes-test-jwt-key'

async function withJwtKey<T>(run: () => Promise<T>): Promise<T> {
  const original = Deno.env.get(JWT_KEY_ENV)
  Deno.env.set(JWT_KEY_ENV, TEST_JWT_KEY)
  try {
    return await run()
  } finally {
    if (original === undefined) Deno.env.delete(JWT_KEY_ENV)
    else Deno.env.set(JWT_KEY_ENV, original)
  }
}

/** A signed, unexpired user token carrying `permissions` as its audience (the claim
 * `@zanix/auth`'s permission check reads). */
function userToken(sub: string, permissions: string[] = []) {
  return createJWT(
    { sub, type: 'user', aud: permissions } as never,
    TEST_JWT_KEY,
    { expiration: '1h' } as never,
  )
}

/** The status a single guard produces for `ctx`: a returned `response`'s status, a thrown
 * `HttpError`'s status, or `undefined` when it lets the request through. */
async function guardStatus(guard: AnyGuard, ctx: unknown): Promise<number | undefined> {
  try {
    const result = await guard(ctx) as { response?: Response } | undefined
    return result?.response?.status
  } catch (error) {
    return (error as { status?: { value?: number } }).status?.value
  }
}

Deno.test('REST routes: every controller endpoint is registered at its expected method/path with its request RTOs', () => {
  const table = Object.fromEntries(
    Object.entries(routes).map(([key, route]) => [
      key,
      [
        route.handler.propertyKey,
        Object.fromEntries(Object.entries(route.rto ?? {}).map(([slot, RTO]) => [slot, RTO.name])),
      ],
    ]),
  )

  assertEquals(table, {
    'POST /login/login': ['login', { Body: 'LoginRTO' }],
    'GET /login/otp/:email': ['loginOtp', {
      Params: 'PwdRecoveryRTO',
      Search: 'LoginOtpSearchRTO',
    }],
    'POST /login/otp/callback': ['loginOtpCallback', { Body: 'OtpLoginRTO' }],
    'POST /login/reactivate': ['confirmReactivation', { Body: 'ReactivationConfirmRTO' }],
    'POST /login/totp/callback': ['loginTotpCallback', { Body: 'TotpLoginRTO' }],
    'GET /login/:oauth': ['oAuth', { Params: 'OAuthQueryRTO', Search: 'OAuthAuthorizeSearchRTO' }],
    'POST /login/:oauth/callback': ['oAuthLogin', {
      Params: 'OAuthQueryRTO',
      Body: 'OAuthLoginRTO',
    }],
    'POST /login/:oauth/link': ['oAuthLink', { Params: 'OAuthQueryRTO', Body: 'OAuthLoginRTO' }],
    'DELETE /login/:oauth': ['oAuthUnlink', { Params: 'OAuthQueryRTO' }],
    'GET /login/methods': ['methods', {}],
    'GET /login/methods/:email': ['loginMethods', { Params: 'PwdRecoveryRTO' }],
    'POST /login/refresh': ['refresh', { Body: 'TokenRTO' }],
    'POST /login/logout': ['logout', { Body: 'TokenRTO' }],
    'GET /login/totp/enroll': ['totpEnroll', {}],
    'POST /login/totp/confirm': ['totpConfirm', { Body: 'TotpConfirmRTO' }],
    'DELETE /login/totp': ['totpDisable', {}],
    'POST /login/phone/enroll': ['phoneEnroll', { Body: 'PhoneEnrollRTO' }],
    'POST /login/phone/confirm': ['phoneConfirm', { Body: 'PhoneConfirmRTO' }],
    'DELETE /login/phone': ['phoneDisable', {}],
    'POST /login/otp-notifier': ['setOtpNotifier', { Body: 'OtpNotifierRTO' }],
    'POST /pwd/change': ['change', { Body: 'PwdRTO' }],
    'POST /pwd/add': ['add', { Body: 'AddPasswordRTO' }],
    'DELETE /pwd/remove': ['remove', {}],
    'GET /pwd/recovery/:email': ['recovery', { Params: 'PwdRecoveryRTO' }],
    'POST /pwd/recovery/callback': ['recoveryCallback', { Body: 'PwdRecoveryCbRTO' }],
    'POST /users/register': ['register', { Body: 'UserRegisterRTO' }],
    'GET /users': ['getOwnProfile', {}],
    'PATCH /users': ['updateOwnProfile', { Body: 'UserProfileRTO' }],
    'PATCH /users/deactivate': ['deactivateOwnAccount', {}],
    'DELETE /users': ['deleteOwnAccount', {}],
    'GET /users/search': ['search', { Search: 'SearchUsersRTO' }],
    'GET /users/lookup': ['lookup', { Search: 'LookupUserRTO' }],
    'GET /users/:id': ['getById', { Params: 'UserIdParamsRTO' }],
    'PATCH /users/:id': ['updateById', { Params: 'UserIdParamsRTO', Body: 'AdminEditUserRTO' }],
    'POST /roles': ['create', { Body: 'CreateRoleRTO' }],
    'GET /roles': ['search', { Search: 'SearchRolesRTO' }],
    'GET /roles/:id': ['getById', { Params: 'RoleIdParamsRTO' }],
    'PATCH /roles/:id': ['update', { Params: 'RoleIdParamsRTO', Body: 'EditRoleRTO' }],
    'DELETE /roles/:id': ['remove', { Params: 'RoleIdParamsRTO' }],
    'POST /roles/assign': ['assign', { Body: 'AssignRoleRTO' }],
    'GET /roles/:id/holders': [
      'holders',
      { Params: 'RoleIdParamsRTO', Search: 'SearchPaginationRTO' },
    ],
    'POST /roles/add': ['add', { Body: 'AccountRolesRTO' }],
    'POST /roles/remove': ['removeFromAccount', { Body: 'AccountRolesRTO' }],
    'GET /roles/accounts/:authId': ['getAccountRoles', { Params: 'AuthIdParamsRTO' }],
    'GET /roles/accounts/:authId/permissions': [
      'getAccountPermissions',
      { Params: 'AuthIdParamsRTO' },
    ],
    'PUT /roles/accounts/:authId': [
      'setAccountRoles',
      { Params: 'AuthIdParamsRTO', Body: 'SetRolesRTO' },
    ],
    'GET /audit': ['search', { Search: 'SearchAuditRTO' }],
    'POST /permissions': ['create', { Body: 'CreatePermissionRTO' }],
    'GET /permissions': ['search', { Search: 'SearchPermissionsRTO' }],
    'GET /permissions/:id': ['getById', { Params: 'PermissionIdParamsRTO' }],
    'PATCH /permissions/:id': [
      'update',
      { Params: 'PermissionIdParamsRTO', Body: 'EditPermissionRTO' },
    ],
    'POST /grant-access': ['create', { Body: 'CreateGrantAccessRTO' }],
    'GET /grant-access': ['search', { Search: 'SearchGrantAccessRTO' }],
    'GET /grant-access/check': ['check', { Search: 'CheckGrantAccessRTO' }],
    'GET /grant-access/:id': ['getById', { Params: 'GrantAccessIdParamsRTO' }],
    'PATCH /grant-access/:id': [
      'update',
      { Params: 'GrantAccessIdParamsRTO', Body: 'EditGrantAccessRTO' },
    ],
    'DELETE /grant-access/:id': ['remove', { Params: 'GrantAccessIdParamsRTO' }],
    'GET /oauth/authorize': ['authorize', { Search: 'OAuthAuthorizeRTO' }],
    'POST /oauth/token': ['token', { Body: 'OAuthTokenExchangeRTO' }],
    'GET /templates/list': ['list', {}],
    'GET /templates/:channel/:name': ['get', { Params: 'TemplateParamsRTO' }],
    'POST /templates': ['create', { Body: 'CreateTemplateRTO' }],
    'PUT /templates/:channel/:name': [
      'update',
      { Body: 'UpdateTemplateRTO', Params: 'TemplateParamsRTO' },
    ],
    'DELETE /templates/:channel/:name': ['remove', { Params: 'TemplateParamsRTO' }],
  })
})

Deno.test('REST routes: refresh runs its identity guard BEFORE the rate limiter (decorators apply bottom-up)', () => {
  assertEquals(routes['POST /login/refresh'].guards.map(guardKind).slice(1), [
    'refreshIdentity',
    'rateLimit',
  ])
})

Deno.test('REST routes: phone/confirm authenticates, then overrides the rate limit, then rate-limits', () => {
  assertEquals(routes['POST /login/phone/confirm'].guards.map(guardKind).slice(1), [
    'jwt',
    'phoneIdentity',
    'rateLimit',
  ])
})

const ADMIN_MUTATION_ROUTES = [
  'POST /roles',
  'PATCH /roles/:id',
  'DELETE /roles/:id',
  'POST /roles/assign',
  'POST /roles/add',
  'POST /roles/remove',
  'PUT /roles/accounts/:authId',
  'POST /permissions',
  'PATCH /permissions/:id',
  'PATCH /users/:id',
]

Deno.test('REST routes: administration mutations authenticate, then override the limit, then rate-limit', () => {
  for (const key of ADMIN_MUTATION_ROUTES) {
    assertEquals(
      routes[key].guards.map(guardKind).slice(1),
      ['jwt', 'rateLimit'],
      `${key} must authenticate before it is counted, and carry the administration limit`,
    )
  }
})

Deno.test('REST routes: an operator gets adminMutationRateLimit mutations per window, across tokens and routes; another operator has their own', async () => {
  const cache = fakeRateLimitCache()
  // Sessions as the token validation leaves them: `id` is the token's jti, `subject` the account.
  // No test below sets `id` to the account: the guard under test must do that.
  const tokenOf = (subject: string, jti: string) => ({
    id: jti,
    subject,
    type: 'user',
    rateLimit: 1000,
  })
  const counted = (key: string) =>
    routes[key].guards.filter((guard) => guardKind(guard) === 'rateLimit')
  let tokens = 0

  // Every request carries a NEW token of operator-1 (a login, a refresh), as a real client would.
  const allowed = await allowedBeforeLimit(
    counted('POST /roles/add'),
    () => guardContext(cache, { session: tokenOf('operator-1', `jti-${tokens++}`) }),
    adminMutationRateLimit + 5,
  )
  assertEquals(allowed, adminMutationRateLimit)
  // Same operator, another token, another administration route: the bucket is already spent.
  assertEquals(
    await allowedBeforeLimit(
      counted('PATCH /roles/:id'),
      () => guardContext(cache, { session: tokenOf('operator-1', `jti-${tokens++}`) }),
      3,
    ),
    0,
  )
  // A different operator has a bucket of their own.
  assertEquals(
    await allowedBeforeLimit(
      counted('POST /roles/add'),
      () => guardContext(cache, { session: tokenOf('operator-2', `jti-${tokens++}`) }),
      3,
    ),
    3,
  )
  assert(cache.keys.every((key) => key.includes('iam:admin-mutations-')))
  assert(cache.keys.some((key) => key.endsWith('-subject:operator-1')))
  assert(!cache.keys.some((key) => key.includes('jti-')), 'the token id is never the bucket key')
})

Deno.test('REST routes: the account lookup authenticates, then rate-limits, in a bucket of its own per operator', async () => {
  assertEquals(
    routes['GET /users/lookup'].guards.map(guardKind).slice(1),
    ['jwt', 'rateLimit'],
    'the lookup must authenticate before it is counted',
  )
  const cache = fakeRateLimitCache()
  const counted = routes['GET /users/lookup'].guards.filter((guard) =>
    guardKind(guard) === 'rateLimit'
  )
  const tokenOf = (subject: string, jti: string) => ({
    id: jti,
    subject,
    type: 'user',
    rateLimit: 1000,
  })
  let tokens = 0
  assertEquals(
    await allowedBeforeLimit(
      counted,
      () => guardContext(cache, { session: tokenOf('operator-1', `jti-${tokens++}`) }),
      adminLookupRateLimit + 5,
    ),
    adminLookupRateLimit,
  )
  assert(adminLookupRateLimit < adminMutationRateLimit, 'the lookup limit is the stricter one')
  assert(cache.keys.every((key) => key.includes('iam:admin-lookups-')))
  assert(cache.keys.some((key) => key.endsWith('-subject:operator-1')))
  // Mutations count apart: the lookup bucket being spent does not limit a mutation.
  const mutation = routes['POST /roles/add'].guards.filter((guard) =>
    guardKind(guard) === 'rateLimit'
  )
  assertEquals(
    await allowedBeforeLimit(
      mutation,
      () => guardContext(cache, { session: tokenOf('operator-1', `jti-${tokens++}`) }),
      3,
    ),
    3,
  )
})

Deno.test('REST routes: reads and self-service routes carry no administration limit', () => {
  for (
    const key of [
      'GET /roles',
      'GET /roles/:id/holders',
      'GET /audit',
      'GET /users/search',
      'GET /users/:id',
      'PATCH /users/deactivate',
    ]
  ) {
    assert(!routes[key].guards.map(guardKind).includes('rateLimit'), key)
  }
})

const SELF_SCOPED_ROUTES = [
  'POST /login/:oauth/link',
  'DELETE /login/:oauth',
  'GET /login/methods',
  'POST /login/logout',
  'GET /login/totp/enroll',
  'POST /login/totp/confirm',
  'DELETE /login/totp',
  'POST /login/phone/enroll',
  'DELETE /login/phone',
  'POST /login/otp-notifier',
  'POST /pwd/change',
  'POST /pwd/add',
  'DELETE /pwd/remove',
  'GET /users',
  'PATCH /users',
  'PATCH /users/deactivate',
  'DELETE /users',
]

Deno.test('REST routes: every self-scoped account route requires an access token', async () => {
  for (const key of [...SELF_SCOPED_ROUTES, 'POST /login/phone/confirm']) {
    const jwtGuard = routes[key].guards.find((guard) => guardKind(guard) === 'jwt')
    assert(jwtGuard, `${key} must carry @AuthTokenValidation()`)
    // deno-lint-ignore no-await-in-loop
    const status = await guardStatus(jwtGuard, guardContext(fakeRateLimitCache()))
    assertEquals(status, 401, `${key} must reject a request with no token`)
  }
})

const P = RBAC_PERMISSIONS
const ADMIN_ROUTE_PERMISSIONS: Record<string, string[]> = {
  'POST /users/register': [P.userWrite],
  'GET /users/search': [P.userRead, P.userWrite],
  'GET /users/lookup': [P.userRead, P.userWrite],
  'GET /users/:id': [P.userRead, P.userWrite],
  'PATCH /users/:id': [P.userWrite],
  'POST /roles': [P.roleWrite],
  'GET /roles': [P.roleRead, P.roleWrite],
  'GET /roles/:id': [P.roleRead, P.roleWrite],
  'PATCH /roles/:id': [P.roleWrite],
  'DELETE /roles/:id': [P.roleWrite],
  'POST /roles/assign': [P.roleWrite],
  'GET /roles/:id/holders': [P.roleRead, P.roleWrite],
  'POST /roles/add': [P.roleWrite],
  'POST /roles/remove': [P.roleWrite],
  'GET /roles/accounts/:authId': [P.roleRead, P.roleWrite],
  'GET /roles/accounts/:authId/permissions': [P.roleRead, P.roleWrite],
  'GET /audit': [P.auditRead],
  'PUT /roles/accounts/:authId': [P.roleWrite],
  'POST /permissions': [P.permissionWrite],
  'GET /permissions': [P.permissionRead, P.permissionWrite],
  'GET /permissions/:id': [P.permissionRead, P.permissionWrite],
  'PATCH /permissions/:id': [P.permissionWrite],
  'POST /grant-access': [P.grantAccessWrite],
  'GET /grant-access': [P.grantAccessRead, P.grantAccessWrite],
  'GET /grant-access/check': [P.grantAccessRead, P.grantAccessWrite],
  'GET /grant-access/:id': [P.grantAccessRead, P.grantAccessWrite],
  'PATCH /grant-access/:id': [P.grantAccessWrite],
  'DELETE /grant-access/:id': [P.grantAccessWrite],
  'GET /templates/list': [P.templatesAccess],
  'GET /templates/:channel/:name': [P.templatesAccess],
  'POST /templates': [P.templatesAccess],
  'PUT /templates/:channel/:name': [P.templatesAccess],
  'DELETE /templates/:channel/:name': [P.templatesAccess],
}

Deno.test('REST routes: every admin route rejects a valid token that lacks its own RBAC permission', async () => {
  await withJwtKey(async () => {
    const token = await userToken('auth-1', [])
    for (const [key, required] of Object.entries(ADMIN_ROUTE_PERMISSIONS)) {
      const jwtGuard = routes[key].guards[1]
      const ctx = guardContext(fakeRateLimitCache(), {
        headers: { authorization: `Bearer ${token}`, [TOKEN_HEADER]: token },
      })
      // deno-lint-ignore no-await-in-loop
      const result = await jwtGuard(ctx) as { response?: Response }
      assertEquals(result.response?.status, 403, `${key} must reject a permissionless token`)
      // deno-lint-ignore no-await-in-loop
      const body = await result.response?.json()
      assertEquals(
        body.cause.cause,
        `Insufficient permissions. Requires any of [${required.join(', ')}].`,
        `${key} must require exactly ${required.join(' | ')}`,
      )
    }
  })
})

Deno.test('REST routes: the route tables above account for every registered route', () => {
  const anonymous = Object.keys(ANONYMOUS_ROUTE_LIMITS)
  const covered = new Set([
    ...SELF_SCOPED_ROUTES,
    ...Object.keys(ADMIN_ROUTE_PERMISSIONS),
    ...anonymous,
    'POST /login/phone/confirm',
  ])
  assertEquals(Object.keys(routes).filter((key) => !covered.has(key)), [])
})

/** Every unauthenticated, IP-rate-limited route: its `@RateLimitGuard` bucket (`app`) and how many
 * requests one client gets per window before a `429`. */
const ANONYMOUS_ROUTE_LIMITS: Record<string, { app: string; limit: number }> = {
  'POST /login/login': { app: 'login:password', limit: freeRateLimit },
  'GET /login/otp/:email': { app: 'login:otp', limit: criticalRateLimit },
  'POST /login/otp/callback': { app: 'login:otp-callback', limit: freeRateLimit },
  'POST /login/reactivate': { app: 'login:reactivate', limit: freeRateLimit },
  'POST /login/totp/callback': { app: 'login:totp-callback', limit: freeRateLimit },
  'GET /login/:oauth': { app: 'login:oauth', limit: criticalRateLimit },
  'POST /login/:oauth/callback': { app: 'login:oauth-callback', limit: freeRateLimit },
  'GET /login/methods/:email': { app: 'login:methods', limit: loginMethodsRateLimit },
  'POST /login/refresh': { app: 'login:refresh', limit: criticalRateLimit },
  'GET /pwd/recovery/:email': { app: 'pwd:recovery', limit: criticalRateLimit },
  'POST /pwd/recovery/callback': { app: 'pwd:recovery-callback', limit: freeRateLimit },
  'GET /oauth/authorize': { app: 'authorize', limit: criticalRateLimit },
  'POST /oauth/token': { app: 'token', limit: freeRateLimit },
}

const LOGIN_AND_PASSWORD_ROUTES = Object.keys(ANONYMOUS_ROUTE_LIMITS).filter((key) =>
  !key.includes(' /oauth/')
)

Deno.test('REST routes: each anonymous login/password route allows exactly its own limit per client', async () => {
  for (const key of LOGIN_AND_PASSWORD_ROUTES) {
    const cache = fakeRateLimitCache()
    // deno-lint-ignore no-await-in-loop
    const allowed = await allowedBeforeLimit(routes[key].guards, () => guardContext(cache))
    assertEquals(allowed, ANONYMOUS_ROUTE_LIMITS[key].limit, `${key} per-client limit`)
  }
})

Deno.test('REST routes: login:methods allows the two lookups one two-step login makes', () => {
  // A two-step login flow looks this route up twice per attempt (a client-side check and the
  // server-side action that re-checks it), so its limit must allow both.
  assert(loginMethodsRateLimit >= 2)
  assertEquals(ANONYMOUS_ROUTE_LIMITS['GET /login/methods/:email'].limit, loginMethodsRateLimit)
})

Deno.test('REST routes: each anonymous login/password route counts in its own rate-limit bucket', async () => {
  const cache = fakeRateLimitCache()
  const bucketByRoute: Record<string, string> = {}
  for (const key of LOGIN_AND_PASSWORD_ROUTES) {
    const before = cache.keys.length
    // deno-lint-ignore no-await-in-loop
    await allowedBeforeLimit(routes[key].guards, () => guardContext(cache), 1)
    bucketByRoute[key] = cache.keys[before]
    assert(
      bucketByRoute[key].includes(`${ANONYMOUS_ROUTE_LIMITS[key].app}-`),
      `${key} must count in the "${ANONYMOUS_ROUTE_LIMITS[key].app}" bucket, got ${
        bucketByRoute[key]
      }`,
    )
  }
  const buckets = Object.values(bucketByRoute)
  assertEquals(new Set(buckets).size, buckets.length, 'no two routes may share a bucket')
})

Deno.test('REST routes: exhausting one route never rate-limits a sibling route for the same client', async () => {
  const cache = fakeRateLimitCache()
  await allowedBeforeLimit(routes['GET /login/methods/:email'].guards, () => guardContext(cache))
  const allowed = await allowedBeforeLimit(
    routes['POST /login/login'].guards,
    () => guardContext(cache),
  )
  assertEquals(allowed, freeRateLimit)
})

Deno.test('REST routes: refresh with a token keys its bucket on the token subject, not the client IP', async () => {
  await withJwtKey(async () => {
    const token = await userToken('auth-42')
    const cache = fakeRateLimitCache()
    await allowedBeforeLimit(
      routes['POST /login/refresh'].guards,
      () => guardContext(cache, { headers: { [TOKEN_HEADER]: token } }),
      1,
    )
    assert(cache.keys[0].endsWith('login:refresh-auth-42'), cache.keys[0])
  })
})

Deno.test('REST routes: phone/confirm caps an authenticated caller at freeRateLimit, not the token-wide rate limit', async () => {
  const guards = routes['POST /login/phone/confirm'].guards
  // Everything after `@AuthTokenValidation()`, starting from the session it leaves behind: an
  // authenticated subject with a generic, account-tier rate limit far above this route's own.
  const afterAuth = guards.slice(guards.findIndex((guard) => guardKind(guard) === 'jwt') + 1)
  const cache = fakeRateLimitCache()
  const allowed = await allowedBeforeLimit(
    afterAuth,
    () => guardContext(cache, { session: { subject: 'auth-7', rateLimit: 100, type: 'user' } }),
  )
  assertEquals(allowed, freeRateLimit)
  assert(cache.keys[0].endsWith('phone:confirm-auth-7'), cache.keys[0])
})

// `@RateLimitGuard` without an explicit `app` (both oauth-provider routes) keys its bucket on the
// decorated method's own name, so these two routes stay isolated from each other and from every
// explicitly-named login/password bucket.
Deno.test('REST routes: /oauth/authorize and /oauth/token each count in their own rate-limit bucket', async () => {
  const cache = fakeRateLimitCache()
  await allowedBeforeLimit(routes['GET /oauth/authorize'].guards, () => guardContext(cache), 1)
  await allowedBeforeLimit(routes['POST /oauth/token'].guards, () => guardContext(cache), 1)
  const [authorizeBucket, tokenBucket] = cache.keys
  assert(authorizeBucket.includes(':authorize-'), `authorize bucket: ${authorizeBucket}`)
  assert(tokenBucket.includes(':token-'), `token bucket: ${tokenBucket}`)
})

Deno.test('REST routes: /oauth/authorize and /oauth/token allow their own per-client limits', async () => {
  for (const key of ['GET /oauth/authorize', 'POST /oauth/token']) {
    const cache = fakeRateLimitCache()
    // deno-lint-ignore no-await-in-loop
    const allowed = await allowedBeforeLimit(routes[key].guards, () => guardContext(cache))
    assertEquals(allowed, ANONYMOUS_ROUTE_LIMITS[key].limit, `${key} per-client limit`)
  }
})

Deno.test('REST routes: no administration route accepts a service credential (`api` session); templates, which does on purpose, is the contrast', async () => {
  const read = (file: string) =>
    Deno.readTextFile(new URL(`../../../../server/handlers/${file}`, import.meta.url))
  for (
    const file of [
      'roles.handler.ts',
      'permissions.handler.ts',
      'users.handler.ts',
      'audit.handler.ts',
    ]
  ) {
    // deno-lint-ignore no-await-in-loop
    const source = await read(file)
    assert(!/type:\s*\[/.test(source), `${file} must not accept more than one session type`)
    assert(!source.includes("'api'"), `${file} must not mention an api session`)
  }
  assert(
    /type:\s*\[/.test(await read('templates.handler.ts')),
    'the contrast: templates accepts both',
  )
})
