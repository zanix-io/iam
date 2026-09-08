import { assertEquals } from 'jsr:@std/assert@0.224'
import { AVAILABLE_LANGS, DEFAULT_LANG } from 'space/constants.ts'

Deno.test('DEFAULT_LANG is always one of AVAILABLE_LANGS', () => {
  assertEquals(AVAILABLE_LANGS.includes(DEFAULT_LANG), true)
})
