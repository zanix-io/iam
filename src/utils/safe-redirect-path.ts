/** An origin no real redirect target uses, against which a candidate path is resolved. */
const PROBE_ORIGIN = 'https://redirect-probe.invalid'

/** Control characters (including tab, CR and LF, which a browser strips from a URL before it
 * parses it) and the backslash, which a browser reads as a slash. */
// deno-lint-ignore no-control-regex
const FORBIDDEN_CHARACTERS = /[\u0000-\u001f\u007f\\]/

/**
 * Whether `value` is a same-origin absolute path a browser will follow to this site and nowhere
 * else. It must start with a single `/`, hold no backslash or control character (`/\evil.com` and
 * `/<tab>/evil.com` are followed as `//evil.com`), and resolve against a probe origin to that same
 * origin.
 */
export function isSameOriginPath(value: string | null | undefined): value is string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return false
  if (FORBIDDEN_CHARACTERS.test(value)) return false
  try {
    return new URL(value, PROBE_ORIGIN).origin === PROBE_ORIGIN
  } catch {
    return false
  }
}
