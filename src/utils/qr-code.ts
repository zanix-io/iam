/**
 * @module
 *
 * Server-side QR-code rendering — pure, DOM-free, no `fetch`/`fs` involved (`qrcode-generator`
 * is a dependency-free pure-JS implementation of the QR encoding algorithm itself, so this runs
 * identically under Deno as it would in any other JS runtime). Rendered inline, as SVG markup, so
 * a page's own `loader` can embed a real scannable code with no extra HTTP request, no separate
 * asset pipeline, and no client-side JS.
 *
 * Used by `space/routes/[lang]/totp/enroll/page.tsx` to render the `otpauth://` provisioning URI
 * `AuthService.totpEnroll()` already computes — this module never constructs that URI itself, only
 * encodes whatever string it's given.
 */

import QRCode from 'qrcode-generator'

/** Default error-correction level — `'M'` (~15% of the code can be damaged/obscured and still
 * scan) is the same default most authenticator-enrollment QR codes in the wild use; there is no
 * per-call reason to raise or lower it for a plain `otpauth://` URI. */
const DEFAULT_ERROR_CORRECTION_LEVEL = 'M'

/** `0` lets `qrcode-generator` pick the smallest QR version (grid size) that fits the given data
 * — an `otpauth://` URI's length varies with the account label/issuer, so a fixed version would
 * either waste space or, worse, silently fail to fit a longer one. */
const AUTO_TYPE_NUMBER = 0

/**
 * Renders `data` as a scannable QR code, returned as inline SVG markup (a `<svg>...</svg>`
 * string) ready to embed directly into a page via `dangerouslySetInnerHTML` — the same
 * cross-renderer-safe prop `@zanix/space-ui`'s own `StructuredData` component uses for raw
 * markup, see that component's own doc for why it's safe under both React and Preact.
 *
 * Safe to embed as-is: `qrcode-generator`'s SVG output encodes `data` purely as pixel geometry
 * (an `isDark(row, col)` matrix turned into `<path>` coordinates) — it never interpolates `data`
 * itself into the markup, so there is no injection surface here regardless of what `data`
 * contains (this call never passes the optional `title`/`alt` text options, the only inputs
 * `qrcode-generator` does interpolate as text into the output, and both are `escapeXml`'d
 * upstream even when supplied).
 *
 * Deterministic: same `data` in, byte-identical SVG string out, every call — no randomness, no
 * timestamp, no hidden environment dependency. Two different inputs always encode to two
 * different module matrices, and therefore two different SVG strings.
 *
 * @param data - The exact string to encode — pass the real value a scanner should read (e.g. an
 * `otpauth://` URI), never a re-derived or partial copy of it.
 * @returns Inline, scalable SVG markup (`viewBox`-sized, no fixed `width`/`height`) encoding
 * `data`.
 * @example
 * const svg = renderQrCodeSvg('otpauth://totp/my-service:jane?secret=ABC&issuer=my-service')
 * // '<svg version="1.1" ...>...</svg>'
 */
export function renderQrCodeSvg(data: string): string {
  const qr = QRCode(AUTO_TYPE_NUMBER, DEFAULT_ERROR_CORRECTION_LEVEL)
  qr.addData(data)
  qr.make()
  return qr.createSvgTag({ scalable: true })
}
