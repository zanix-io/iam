import { assert, assertEquals } from 'jsr:@std/assert@0.224'
import { attachRequestToError } from '@zanix/server'

import { redirectIamUnauthorized } from '../../../sdk/redirect-unauthorized.ts'

/** A minimal stand-in for a real `HttpError('UNAUTHORIZED', {...})` — a real `Error` subclass (so
 * `attachRequestToError<E extends Error>` accepts it), carrying only the shape this handler
 * actually reads structurally (`name`/`status.value`/`code`), never `instanceof`-checked. */
class FakeUnauthorizedError extends Error {
  public override name = 'HttpError'
  public status: { code: string; value: number }
  public code?: string
  constructor(code?: string, statusValue: number = 401) {
    super('fake unauthorized')
    this.status = { code: statusValue === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', value: statusValue }
    this.code = code
  }
}

Deno.test(
  'redirectIamUnauthorized: NO_SESSION_COOKIE reports reason "no-session"',
  async () => {
    const error = attachRequestToError(
      new FakeUnauthorizedError('NO_SESSION_COOKIE'),
      new Request('https://example.test/es/profile'),
    )
    let observedReason: string | undefined
    const handler = redirectIamUnauthorized({
      loginUrl: (request, reason) => {
        observedReason = reason
        return `/${new URL(request.url).pathname.split('/')[1]}/login`
      },
    })

    const response = await handler(error)

    assert(response instanceof Response, 'expected a real Response, not undefined')
    assertEquals(response.status, 302)
    assertEquals(response.headers.get('location'), '/es/login')
    assertEquals(observedReason, 'no-session')
  },
)

Deno.test(
  'redirectIamUnauthorized: SESSION_REFRESH_FAILED reports reason "session-expired"',
  async () => {
    const error = attachRequestToError(
      new FakeUnauthorizedError('SESSION_REFRESH_FAILED'),
      new Request('https://example.test/es/profile'),
    )
    let observedReason: string | undefined
    const handler = redirectIamUnauthorized({
      loginUrl: (request, reason) => {
        observedReason = reason
        return `/${new URL(request.url).pathname.split('/')[1]}/login`
      },
    })

    await handler(error)

    assertEquals(observedReason, 'session-expired')
  },
)

Deno.test(
  'redirectIamUnauthorized: an UNAUTHORIZED with no `code` at all still reports "session-expired" ' +
    '— the safer default, never mistaking an unrecognized shape for "no session"',
  async () => {
    const error = attachRequestToError(
      new FakeUnauthorizedError(),
      new Request('https://example.test/es/profile'),
    )
    let observedReason: string | undefined
    const handler = redirectIamUnauthorized({
      loginUrl: (request, reason) => {
        observedReason = reason
        return `/${new URL(request.url).pathname.split('/')[1]}/login`
      },
    })

    await handler(error)

    assertEquals(observedReason, 'session-expired')
  },
)

Deno.test(
  'redirectIamUnauthorized: redirects a 401 from a DIFFERENT HttpError class (a second copy of ' +
    '@zanix/errors) — matched by shape, never an `instanceof` check',
  async () => {
    // A DIFFERENT class than `FakeUnauthorizedError` above — the same shape as a
    // second, independently-resolved copy of `@zanix/errors`'s own `HttpError` under `zanix space
    // dev`'s dev-mode SSR bundler.
    class OtherPackageHttpError extends Error {
      public override name = 'HttpError'
      public status = { code: 'UNAUTHORIZED', value: 401 }
      public code = 'NO_SESSION_COOKIE'
    }
    const error = attachRequestToError(
      new OtherPackageHttpError('No session cookie present.'),
      new Request('https://example.test/es/profile'),
    )
    const handler = redirectIamUnauthorized({
      loginUrl: (request) => `/${new URL(request.url).pathname.split('/')[1]}/login`,
    })

    const response = await handler(error)

    assert(response instanceof Response, 'expected a real Response, not undefined')
    assertEquals(response.status, 302)
  },
)

Deno.test('redirectIamUnauthorized: declines a 403, a non-HttpError throw, and no-request-attached', async () => {
  const handler = redirectIamUnauthorized({ loginUrl: () => '/es/login' })

  assertEquals(
    await handler(
      attachRequestToError(
        new FakeUnauthorizedError(undefined, 403),
        new Request('https://example.test/es/profile'),
      ),
    ),
    undefined,
  )
  assertEquals(await handler(new Error('boom')), undefined)
  assertEquals(
    await handler({ name: 'HttpError', status: { code: 'UNAUTHORIZED', value: 401 } }),
    undefined,
  )
})

Deno.test('redirectIamUnauthorized: declines primitives and null without throwing', async () => {
  const handler = redirectIamUnauthorized({ loginUrl: () => '/es/login' })

  assertEquals(await handler(null), undefined)
  assertEquals(await handler(undefined), undefined)
  assertEquals(await handler('boom'), undefined)
  assertEquals(await handler(401), undefined)
})
