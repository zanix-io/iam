import { assertEquals } from 'jsr:@std/assert@0.224'
import { isSameOriginPath } from 'utils/safe-redirect-path.ts'

Deno.test('isSameOriginPath: accepts absolute paths with a query, a fragment and encoded characters', () => {
  for (const ok of ['/', '/es/home', '/a/b?x=1&y=2', '/a#frag', '/caf%C3%A9', '/a%5Cb', '/a//b']) {
    assertEquals(isSameOriginPath(ok), true, ok)
  }
})

Deno.test('isSameOriginPath: rejects protocol-relative values and their backslash variants', () => {
  for (const bad of ['//evil.test', '/\\evil.test', '/\\/evil.test', '/\\\\evil.test', '/a\\b']) {
    assertEquals(isSameOriginPath(bad), false, JSON.stringify(bad))
  }
})

Deno.test('isSameOriginPath: rejects tab, newline, carriage return, NUL and DEL anywhere, which browsers strip or mis-parse', () => {
  for (
    const bad of [
      '/\t/evil.test',
      '/\n/evil.test',
      '/\r/evil.test',
      '/\u0000x',
      '/a\u007fb',
      '/ok\t',
    ]
  ) {
    assertEquals(isSameOriginPath(bad), false, JSON.stringify(bad))
  }
})

Deno.test('isSameOriginPath: rejects anything that is not an absolute path', () => {
  for (
    const bad of [
      '',
      'evil',
      'https://evil.test',
      'javascript:alert(1)',
      ' //evil.test',
      '\t//evil.test',
    ]
  ) {
    assertEquals(isSameOriginPath(bad), false, JSON.stringify(bad))
  }
  assertEquals(isSameOriginPath(null), false)
  assertEquals(isSameOriginPath(undefined), false)
})
