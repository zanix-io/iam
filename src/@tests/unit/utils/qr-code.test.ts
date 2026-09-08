import { assertEquals, assertMatch, assertNotEquals } from 'jsr:@std/assert@0.224'
import QRCode from 'qrcode-generator'

import { renderQrCodeSvg } from 'utils/qr-code.ts'

/**
 * Pure-function coverage for `renderQrCodeSvg` — no rendering/DOM involved, just the string it
 * returns. `otpauth-independent-reconstruction` below is the real "does it encode the given
 * string" check: it rebuilds the SVG straight from `qrcode-generator` itself, with the exact same
 * call shape `renderQrCodeSvg` uses, and asserts a byte-for-byte match — a change to `data`, the
 * error-correction level, or the `scalable` option would break this test, not just "did it throw".
 */

const SAMPLE_URI = 'otpauth://totp/zanix-iam:jane@example.com?secret=SECRET123&issuer=zanix-iam'

Deno.test('renderQrCodeSvg: returns real, well-formed SVG markup', () => {
  const svg = renderQrCodeSvg(SAMPLE_URI)
  assertMatch(svg, /^<svg[\s\S]*<\/svg>$/)
  assertMatch(svg, /viewBox="0 0 \d+ \d+"/)
})

Deno.test('renderQrCodeSvg: deterministic — identical input always returns identical output', () => {
  assertEquals(renderQrCodeSvg(SAMPLE_URI), renderQrCodeSvg(SAMPLE_URI))
})

Deno.test('renderQrCodeSvg: different input always encodes to different output', () => {
  const other = 'otpauth://totp/zanix-iam:john@example.com?secret=OTHERSECRET&issuer=zanix-iam'
  assertNotEquals(renderQrCodeSvg(SAMPLE_URI), renderQrCodeSvg(other))
})

Deno.test('renderQrCodeSvg: encodes the EXACT given string — independently reconstructed match', () => {
  const qr = QRCode(0, 'M')
  qr.addData(SAMPLE_URI)
  qr.make()
  const expected = qr.createSvgTag({ scalable: true })
  assertEquals(renderQrCodeSvg(SAMPLE_URI), expected)
})

Deno.test('renderQrCodeSvg: never interpolates the raw data string into the markup', () => {
  // `SAMPLE_URI` itself never appears as text in the output — `qrcode-generator` encodes it
  // purely as pixel geometry (see `renderQrCodeSvg`'s own doc), so the literal string is never a
  // substring of the SVG it returns.
  const svg = renderQrCodeSvg(SAMPLE_URI)
  assertEquals(svg.includes(SAMPLE_URI), false)
})
