import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@0.224'

import {
  BACKUP_CODE_ALPHABET,
  BACKUP_CODE_LENGTH,
  generateBackupCode,
  generateBackupCodes,
  hashBackupCode,
  hashBackupCodes,
  normalizeBackupCode,
} from 'utils/backup-codes.ts'
import { BACKUP_CODE_COUNT } from 'utils/constants.ts'

Deno.test('generateBackupCode: XXXXX-XXXXX from the unambiguous alphabet', () => {
  for (let index = 0; index < 500; index++) {
    const code = generateBackupCode()
    assert(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/.test(code), code)
  }
})

Deno.test('the alphabet has 32 characters and none that is confused with another', () => {
  assertEquals(BACKUP_CODE_ALPHABET.length, 32)
  assertEquals(new Set(BACKUP_CODE_ALPHABET).size, 32)
  for (const ambiguous of ['0', '1', 'I', 'O']) assert(!BACKUP_CODE_ALPHABET.includes(ambiguous))
})

Deno.test('a code carries at least 50 bits: 10 characters of 5 bits', () => {
  assertEquals(BACKUP_CODE_LENGTH * Math.log2(BACKUP_CODE_ALPHABET.length), 50)
})

Deno.test('generateBackupCode: every character shows up and none is favored (no modulo bias)', () => {
  const counts = new Map<string, number>()
  const draws = 4000
  for (let index = 0; index < draws; index++) {
    for (const char of generateBackupCode().replace('-', '')) {
      counts.set(char, (counts.get(char) ?? 0) + 1)
    }
  }
  assertEquals(counts.size, 32)
  const expected = (draws * BACKUP_CODE_LENGTH) / 32
  for (const count of counts.values()) {
    assert(count > expected * 0.85 && count < expected * 1.15, `${count} vs ${expected}`)
  }
})

Deno.test('generateBackupCodes: 10 different codes by default', () => {
  const codes = generateBackupCodes()
  assertEquals(codes.length, BACKUP_CODE_COUNT)
  assertEquals(new Set(codes).size, BACKUP_CODE_COUNT)
  assertNotEquals(codes, generateBackupCodes())
})

Deno.test('normalizeBackupCode: case, dashes and spaces are ignored', () => {
  assertEquals(normalizeBackupCode('abcde-fghjk'), 'ABCDEFGHJK')
  assertEquals(normalizeBackupCode(' ABCDE FGHJK '), 'ABCDEFGHJK')
  assertEquals(normalizeBackupCode('a-b-c-d-e-f-g-h-j-k'), 'ABCDEFGHJK')
  assertEquals(normalizeBackupCode(generateBackupCode()) !== undefined, true)
})

Deno.test('normalizeBackupCode: anything that is not shaped like a backup code is undefined', () => {
  for (
    const input of [
      '',
      '123456', // an authenticator code is never read as a backup code
      'ABCDE-FGHJ', // short
      'ABCDE-FGHJKL', // long
      'ABCDE-FGHJ0', // 0 is not in the alphabet
      'ABCDE-FGHJI', // I is not in the alphabet
      'ABCDE_FGHJK',
    ]
  ) {
    assertEquals(normalizeBackupCode(input), undefined, input)
  }
})

Deno.test('hashBackupCode: the digest is not the code, is stable, and depends on the account', async () => {
  const code = 'ABCDEFGHJK'
  const hash = await hashBackupCode('auth-1', code)
  assertEquals(hash, await hashBackupCode('auth-1', code))
  assertNotEquals(hash, await hashBackupCode('auth-2', code))
  assertNotEquals(hash, await hashBackupCode('auth-1', 'ABCDEFGHJL'))
  assert(!hash.includes(code))
})

Deno.test('hashBackupCodes: one digest per code, the typed form and the stored form match', async () => {
  const codes = generateBackupCodes(3)
  const hashes = await hashBackupCodes('auth-1', codes)
  assertEquals(hashes.length, 3)
  for (const [index, code] of codes.entries()) {
    // deno-lint-ignore no-await-in-loop
    assertEquals(hashes[index], await hashBackupCode('auth-1', normalizeBackupCode(code) as string))
    assert(!hashes[index].includes(code.replace('-', '')))
  }
})
