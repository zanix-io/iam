import { assertEquals } from 'jsr:@std/assert@0.224'
import { attachRequestToError, RestClientError } from '@zanix/server'
import { redirectSessionRefreshFailure } from '../../../sdk/redirect-session-refresh-failure.ts'

const failure = (upstreamStatus: number | undefined, url: string) =>
  attachRequestToError(
    new RestClientError('BAD_GATEWAY', {
      message: 'upstream',
      meta: upstreamStatus === undefined ? {} : { upstreamStatus },
    }),
    new Request(url),
  )

const location = (response: Response | undefined) => response?.headers.get('location') ?? ''

Deno.test('a 429 becomes the rate-limited state and remembers the page being visited', () => {
  const handler = redirectSessionRefreshFailure({ defaultLang: 'en' })
  const response = handler(failure(429, 'https://app.test/es/orders?tab=2'))
  assertEquals(response?.status, 302)
  assertEquals(
    location(response),
    '/es/login?error=rate_limited&redirect_to=%2Fes%2Forders%3Ftab%3D2',
  )
})

Deno.test('any other upstream fault becomes the generic unexpected-error state', () => {
  const handler = redirectSessionRefreshFailure({ defaultLang: 'en' })
  assertEquals(
    location(handler(failure(502, 'https://app.test/es/orders'))),
    '/es/login?error=unexpected_error&redirect_to=%2Fes%2Forders',
  )
  assertEquals(
    location(handler(failure(undefined, 'https://app.test/es/orders'))),
    '/es/login?error=unexpected_error&redirect_to=%2Fes%2Forders',
  )
})

Deno.test('the app chooses the fallback language and its own login path', () => {
  const handler = redirectSessionRefreshFailure({
    defaultLang: 'en',
    loginPath: (lang) => `/${lang}/sign-in`,
  })
  assertEquals(
    location(handler(failure(502, 'https://app.test/'))),
    '/en/sign-in?error=unexpected_error&redirect_to=%2F',
  )
})

Deno.test('it declines what is not its own, so it composes in an error-handler chain', () => {
  const handler = redirectSessionRefreshFailure({ defaultLang: 'en' })
  assertEquals(handler(new Error('boom')), undefined)
  assertEquals(handler('boom'), undefined)
  // A RestClientError with no request attached cannot be redirected anywhere.
  assertEquals(
    handler(new RestClientError('BAD_GATEWAY', { message: 'x', meta: { upstreamStatus: 502 } })),
    undefined,
  )
})
