import { assertEquals } from 'jsr:@std/assert@0.224'
import { SESSION_HEADERS } from '@zanix/server'
import { hasSessionCookie } from 'space/session-cookie.ts'

const TOKEN_NAME = SESSION_HEADERS.user.token as string

Deno.test('hasSessionCookie: false with no Cookie header at all', () => {
  const request = new Request('http://localhost/')
  assertEquals(hasSessionCookie(request), false)
})

Deno.test('hasSessionCookie: false when the cookie is absent among others', () => {
  const request = new Request('http://localhost/', {
    headers: { cookie: 'other=1; unrelated=2' },
  })
  assertEquals(hasSessionCookie(request), false)
})

Deno.test('hasSessionCookie: true when the session cookie is present', () => {
  const request = new Request('http://localhost/', {
    headers: { cookie: `other=1; ${TOKEN_NAME}=abc.def.ghi` },
  })
  assertEquals(hasSessionCookie(request), true)
})

Deno.test('hasSessionCookie: does not false-positive on a cookie whose VALUE merely contains the name', () => {
  // The token name must start a real cookie PAIR (`name=`), never appear only inside another
  // cookie's value — see this helper's own doc for why a plain substring scan is still safe.
  const request = new Request('http://localhost/', {
    headers: { cookie: `other=${TOKEN_NAME}=fake` },
  })
  assertEquals(hasSessionCookie(request), false)
})
