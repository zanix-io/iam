import { assertEquals } from 'jsr:@std/assert@0.224'
import { DEFAULT_REDACT_PATTERN } from '@zanix/errors'

import { IAM_LOGGER_SETUP, IAM_REDACTED_KEYS } from 'utils/log-redaction.ts'

Deno.test('IAM_REDACTED_KEYS: names exactly the keys the default pattern misses', () => {
  for (const key of IAM_REDACTED_KEYS) {
    assertEquals(DEFAULT_REDACT_PATTERN.test(key), false, `${key} is already covered by default`)
  }
})

Deno.test('IAM_REDACTED_KEYS: never lists a bare code, which error responses use as their stable error code', () => {
  assertEquals(IAM_REDACTED_KEYS.includes('code'), false)
})

Deno.test('IAM_LOGGER_SETUP: extends, never replaces, the default redaction', () => {
  const redact = IAM_LOGGER_SETUP.logger?.redact
  assertEquals(typeof redact, 'object')
  assertEquals((redact as { pattern?: RegExp }).pattern, undefined)
  assertEquals((redact as { extend?: unknown[] }).extend, [...IAM_REDACTED_KEYS])
})
