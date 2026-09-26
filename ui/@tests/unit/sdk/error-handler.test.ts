import { assertEquals } from 'jsr:@std/assert@0.224'
import { attachRequestToError, RestClientError } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import { iamErrorHandler } from '../../../sdk/error-handler.ts'

const withRequest = <E extends Error>(error: E, url: string): E =>
  attachRequestToError(error, new Request(url))

const location = (response: Response | undefined) => response?.headers.get('location') ?? ''

Deno.test('a request with no session goes to the login page with the page it wanted', async () => {
  const handler = iamErrorHandler({ defaultLang: 'es' })
  const error = withRequest(
    new HttpError('UNAUTHORIZED', { code: 'NO_SESSION_COOKIE', message: 'no session' }),
    'https://app.test/en/orders?tab=2',
  )
  const response = await handler(error)
  assertEquals(response?.status, 302)
  assertEquals(
    location(response),
    '/en/login?redirect_to=%2Fen%2Forders%3Ftab%3D2&error=no_session',
  )
})

Deno.test('a refresh that iam rate-limited goes to the login page with that state', async () => {
  const handler = iamErrorHandler({ defaultLang: 'es' })
  const error = withRequest(
    new RestClientError('BAD_GATEWAY', { message: 'upstream', meta: { upstreamStatus: 429 } }),
    'https://app.test/es/orders',
  )
  assertEquals(
    location(await handler(error)),
    '/es/login?error=rate_limited&redirect_to=%2Fes%2Forders',
  )
})

Deno.test('the app picks its fallback language and its own login path', async () => {
  const handler = iamErrorHandler({ defaultLang: '', loginPath: () => '/login' })
  const error = withRequest(
    new HttpError('UNAUTHORIZED', { code: 'NO_SESSION_COOKIE', message: 'no session' }),
    'https://app.test/moderation',
  )
  assertEquals(location(await handler(error)), '/login?redirect_to=%2Fmoderation&error=no_session')
})

Deno.test('the app`s own handlers run before the redirects', async () => {
  const handler = iamErrorHandler({
    defaultLang: 'es',
    before: [() => new Response(null, { status: 302, headers: { location: '/es/apply' } })],
  })
  const error = withRequest(
    new HttpError('UNAUTHORIZED', { code: 'NO_SESSION_COOKIE', message: 'no session' }),
    'https://app.test/es/panel',
  )
  assertEquals(location(await handler(error)), '/es/apply')
})

Deno.test('an error none of the handlers own is left to the server', async () => {
  const handler = iamErrorHandler({ defaultLang: 'es' })
  assertEquals(await handler(withRequest(new Error('boom'), 'https://app.test/es/')), undefined)
})
