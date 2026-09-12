/** Props {@linkcode createCookieConsentModal}'s returned component expects — the exact shape
 * `iam`'s own comet wrapper (`space/comets/cookie-consent-modal.comet.tsx`) passes through. */
export type CookieConsentModalProps = {
  /**
   * The current request's own resolved `{lang}` segment — threaded through to
   * `buildConsentRequest` so the Accept/Decline round trip always targets THIS page's own
   * `/{lang}/consent`, never a hardcoded or missing prefix.
   */
  lang: string
  /**
   * Whether this request's own `Cookie` header already carries a RECORDED consent decision
   * (Accept OR Decline) — resolved server-side so this modal's initial open/closed state is
   * correct from the very first byte, not just after client hydration.
   */
  initialDecided: boolean
  /** This request's own CSP nonce, threaded straight through to `Modal`'s own `nonce` prop so its
   * self-rendered positioning `<style>` element survives a zero-config nonce-based `style-src`
   * from the very first server-rendered byte. `undefined` when no nonce-based CSP is in effect. */
  cspNonce?: string
}

/** Result of building the consent round trip — {@linkcode createCookieConsentModal}'s injected
 * `fetch` dependency receives this shape's `url`/`init` directly. */
export type ConsentRequest = { url: string; init: RequestInit }
