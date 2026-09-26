import {
  assertEquals,
  assertExists,
  assertFalse,
  assertStringIncludes,
} from 'jsr:@std/assert@0.224'
import { GENERAL_HEADERS } from '@zanix/server'
import type { GuardContext } from '@zanix/server'
import { cookiesAcceptedGuard } from '../../../sdk/cookies-accepted-guard.ts'

const HEADER = GENERAL_HEADERS.cookiesAcceptedHeader

const guardContext = () =>
  ({
    req: new Request('http://localhost/es/login'),
    cookies: Object.freeze({}),
  }) as unknown as GuardContext

Deno.test('cookiesAcceptedGuard: puts the accepted header on a fresh ctx.req, never on ctx.cookies', () => {
  const ctx = guardContext()
  const original = ctx.req
  cookiesAcceptedGuard()(ctx)
  assertEquals(ctx.req.headers.get(HEADER), 'true')
  assertEquals(ctx.cookies[HEADER], undefined)
  assertFalse(ctx.req === original)
})

Deno.test('cookiesAcceptedGuard: the cookie it sets lasts a year, matching the session cookie of the same name', () => {
  const { headers } = cookiesAcceptedGuard()(guardContext()) as { headers?: Record<string, string> }
  const setCookie = headers?.['Set-Cookie']
  assertExists(setCookie)
  assertStringIncludes(setCookie, `${HEADER}=true`)
  assertStringIncludes(setCookie, 'Max-Age=31536000')
  assertStringIncludes(setCookie, 'SameSite=Strict')
})
