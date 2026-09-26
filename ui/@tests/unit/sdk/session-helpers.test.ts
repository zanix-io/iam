import { assertEquals, assertThrows } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'
import {
  hasSessionCookie,
  requireAccessToken,
  requireOwnUserId,
} from '../../../sdk/session-helpers.ts'

Deno.test('requireAccessToken: returns the session access token when present', () => {
  assertEquals(
    requireAccessToken({ session: { id: 'u1', type: 'user', accessToken: 'abc' } } as never),
    'abc',
  )
})

Deno.test('requireAccessToken: throws UNAUTHORIZED without a session or an access token', () => {
  assertThrows(() => requireAccessToken({ session: undefined } as never), HttpError)
  assertThrows(() => requireAccessToken({ session: { id: 'u1' } } as never), HttpError)
})

Deno.test('requireOwnUserId: returns the session subject, not the token id', () => {
  assertEquals(requireOwnUserId({ session: { subject: 'u1', id: 'jti-1' } } as never), 'u1')
})

Deno.test('requireOwnUserId: throws when there is no session subject', () => {
  assertThrows(() => requireOwnUserId({ session: undefined } as never))
  assertThrows(() => requireOwnUserId({ session: { id: 'jti-1' } } as never))
})

const requestWithCookie = (cookie?: string) =>
  new Request('http://localhost/', { headers: cookie ? { cookie } : {} })

Deno.test('hasSessionCookie: true when the refresh-token cookie is present, among others or not', () => {
  assertEquals(hasSessionCookie(requestWithCookie('X-Znx-App-Token=t')), true)
  assertEquals(
    hasSessionCookie(requestWithCookie('X-Znx-Cookies-Accepted=true; X-Znx-App-Token=t')),
    true,
  )
})

Deno.test('hasSessionCookie: false with no cookie header or only unrelated cookies', () => {
  assertEquals(hasSessionCookie(requestWithCookie()), false)
  assertEquals(hasSessionCookie(requestWithCookie('X-Znx-Cookies-Accepted=true')), false)
})
