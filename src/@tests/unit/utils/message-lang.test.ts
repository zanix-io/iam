import { assertEquals } from 'jsr:@std/assert@0.224'
import {
  contextMessageLang,
  MESSAGE_LANG_LOCALS_KEY,
  messageLangGuard,
  resolveMessageLang,
} from 'utils/message-lang.ts'

const request = (headers: Record<string, string> = {}, query = '') => ({
  req: new Request(`http://localhost/login/otp/a@b.com${query}`, { headers }),
  url: new URL(`http://localhost/login/otp/a@b.com${query}`),
})

Deno.test('resolveMessageLang: ?lang= wins over Accept-Language, and an invalid ?lang= falls to it', () => {
  const both = request({ 'accept-language': 'en' }, '?lang=es')
  assertEquals(resolveMessageLang(both.req, both.url), 'es')
  const invalid = request({ 'accept-language': 'en' }, '?lang=%3Cx%3E')
  assertEquals(resolveMessageLang(invalid.req, invalid.url), 'en')
  const none = request()
  assertEquals(resolveMessageLang(none.req, none.url), undefined)
})

Deno.test('messageLangGuard records the language in ctx.locals, where the interactors read it', () => {
  const { req, url } = request({ 'accept-language': 'es-MX' })
  const locals: Record<string, unknown> = {}

  assertEquals(messageLangGuard()({ req, url, locals } as never), {})

  assertEquals(locals[MESSAGE_LANG_LOCALS_KEY], 'es-MX')
  assertEquals(contextMessageLang({ locals }), 'es-MX')
  // Nothing to record: nothing is written.
  const empty: Record<string, unknown> = {}
  const bare = request()
  messageLangGuard()({ req: bare.req, url: bare.url, locals: empty } as never)
  assertEquals(contextMessageLang({ locals: empty }), undefined)
})
