import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@0.224'
import {
  buildRateLimitedQuery,
  decodeEmailParam,
  parseRetryUntil,
  readLoginErrorState,
  redirectResponse,
  resolvePostLoginRedirect,
  unauthorizedLoginUrl,
  withRedirectToParam,
} from '../../../sdk/login-flow.ts'

const url = (search: string) => new URL(`https://app.test/es/login${search}`)

Deno.test('decodeEmailParam: decodes an address, keeps a malformed sequence as it is', () => {
  assertEquals(decodeEmailParam('jane%2Bx%40example.com'), 'jane+x@example.com')
  assertEquals(decodeEmailParam('%E0%A4%A'), '%E0%A4%A')
})

Deno.test('resolvePostLoginRedirect: a safe redirect_to wins, else the default the app chose', () => {
  assertEquals(resolvePostLoginRedirect(url('?redirect_to=/es/orders'), '/es/home'), '/es/orders')
  assertEquals(resolvePostLoginRedirect(url(''), '/dashboard'), '/dashboard')
})

Deno.test('resolvePostLoginRedirect: rejects anything that is not a same-origin path', () => {
  for (const unsafe of ['//evil.test', 'https://evil.test/x', 'evil', '']) {
    assertEquals(
      resolvePostLoginRedirect(url(`?redirect_to=${encodeURIComponent(unsafe)}`), '/home'),
      '/home',
      unsafe,
    )
  }
})

Deno.test('withRedirectToParam: carries a safe destination through another hop, and only that', () => {
  assertEquals(
    withRedirectToParam('/es/login/totp/a', url('?redirect_to=/es/orders?x=1')),
    '/es/login/totp/a?redirect_to=%2Fes%2Forders%3Fx%3D1',
  )
  assertEquals(
    withRedirectToParam('/es/login/totp/a?error=invalid_code', url('?redirect_to=/es/orders')),
    '/es/login/totp/a?error=invalid_code&redirect_to=%2Fes%2Forders',
  )
  assertEquals(withRedirectToParam('/p', url('')), '/p')
  assertEquals(withRedirectToParam('/p', url('?redirect_to=//evil.test')), '/p')
})

Deno.test('buildRateLimitedQuery: an absolute retryUntil when the error says how long, plain otherwise', () => {
  const before = Date.now()
  const query = buildRateLimitedQuery({ retryAfterSeconds: 30 })
  const retryUntil = Number(new URLSearchParams(query).get('retryUntil'))
  assertEquals(new URLSearchParams(query).get('error'), 'rate_limited')
  assert(retryUntil >= before + 30_000 && retryUntil <= Date.now() + 30_000)
  assertEquals(buildRateLimitedQuery(new Error('x')), 'error=rate_limited')
  assertEquals(buildRateLimitedQuery(null), 'error=rate_limited')
})

Deno.test('parseRetryUntil: a number, never NaN', () => {
  assertEquals(parseRetryUntil(url('?retryUntil=1700000000000')), 1700000000000)
  assertEquals(parseRetryUntil(url('?retryUntil=abc')), undefined)
  assertEquals(parseRetryUntil(url('')), undefined)
})

Deno.test('readLoginErrorState: the two states every screen shares', () => {
  assertEquals(readLoginErrorState(url('?error=rate_limited')), {
    rateLimited: true,
    unexpectedError: false,
  })
  assertEquals(readLoginErrorState(url('?error=unexpected_error')), {
    rateLimited: false,
    unexpectedError: true,
  })
  assertEquals(readLoginErrorState(url('?error=invalid_code')), {
    rateLimited: false,
    unexpectedError: false,
  })
})

Deno.test('redirectResponse: a redirect whose headers stay mutable for the session interceptor', () => {
  const response = redirectResponse('/es/home')
  assertEquals(response.status, 303)
  assertEquals(response.headers.get('location'), '/es/home')
  response.headers.append('set-cookie', 'a=b') // throws on Response.redirect()
  assertNotEquals(response.headers.get('set-cookie'), null)
})

Deno.test('unauthorizedLoginUrl: the app login page with the visited page, and a first visit told apart', () => {
  const loginUrl = unauthorizedLoginUrl({ defaultLang: 'en' })
  const request = new Request('https://app.test/es/orders?tab=2')
  assertEquals(
    loginUrl(request, 'session-expired'),
    '/es/login?redirect_to=%2Fes%2Forders%3Ftab%3D2',
  )
  assertEquals(
    loginUrl(request, 'no-session'),
    '/es/login?redirect_to=%2Fes%2Forders%3Ftab%3D2&error=no_session',
  )
  assertEquals(
    unauthorizedLoginUrl({ defaultLang: 'en', loginPath: (lang) => `/${lang}/sign-in` })(
      new Request('https://app.test/'),
      'session-expired',
    ),
    '/en/sign-in?redirect_to=%2F',
  )
})
