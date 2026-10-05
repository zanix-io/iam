import { assertEquals, assertNotEquals } from 'jsr:@std/assert@0.224'
import { computeEmailKeyId, emailLookupCandidates } from 'server/repositories/auth/email-key.ts'

Deno.test('computeEmailKeyId: deterministic — the same email always produces the same digest', async () => {
  const first = await computeEmailKeyId('dev@zanix-iam.local')
  const second = await computeEmailKeyId('dev@zanix-iam.local')
  assertEquals(first, second)
})

Deno.test('computeEmailKeyId: different emails produce different digests', async () => {
  const a = await computeEmailKeyId('dev@zanix-iam.local')
  const b = await computeEmailKeyId('other@zanix-iam.local')
  assertNotEquals(a, b)
})

Deno.test("computeEmailKeyId: case-sensitive — differs by case, the same exact-match semantics as a lookup on the `email` field itself (see email-key.ts's own doc)", async () => {
  const lower = await computeEmailKeyId('dev@zanix-iam.local')
  const upper = await computeEmailKeyId('Dev@Zanix-IAM.local')
  assertNotEquals(lower, upper)
})

Deno.test('computeEmailKeyId: carries no random salt — unlike a password hash, the raw digest is returned with no salt prefix', async () => {
  const digest = await computeEmailKeyId('dev@zanix-iam.local')
  // `generateHash`'s own salted form prefixes a hex salt followed by `$` — asserting its absence
  // is what actually proves `useSalt: false` took effect, not just that SOME string came back.
  assertEquals(digest.includes('$'), false)
})

Deno.test('computeEmailKeyId: matches the real, precomputed value seeded for the dev account (seeders.dev.ts)', async () => {
  // Pins the literal `seeders.dev.ts` hardcodes: a different `level`/`useSalt` argument or
  // primitive would make `AuthRepository.findByEmail('dev@zanix-iam.local')` stop matching it.
  const digest = await computeEmailKeyId('dev@zanix-iam.local')
  assertEquals(digest, 'z/g1KkUpQzbJvd7ZgJDBmzUAnIQ=')
})

Deno.test('emailLookupCandidates: the address trimmed, then its lowercase form when it differs', () => {
  assertEquals(emailLookupCandidates('jane@example.com'), ['jane@example.com'])
  assertEquals(emailLookupCandidates('  Jane@Example.com \n'), [
    'Jane@Example.com',
    'jane@example.com',
  ])
  assertEquals(emailLookupCandidates('  jane@example.com '), ['jane@example.com'])
})
