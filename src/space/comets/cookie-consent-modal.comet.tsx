'use comet'

import { useState } from 'react'
import type { ReactElement } from 'react'
import { defineComet } from '@zanix/space/comet'
import { Button, Modal } from '@zanix/space-ui'
import { buildConsentRequest } from 'utils/cookie-consent.ts'

/** The real, literal (never CSS-Module-hashed) class name `./cookie-consent-modal.css` declares —
 * see this project's own `space.app.ts`, and this comet's own doc, for why that stylesheet is a
 * plain CSS file wired through `defineSpaceApp({ globalCss })` rather than a `*.module.css` import
 * here. */
const DIALOG_CLASS_NAME = 'cookie-consent-dialog'

/** Props for {@linkcode CookieConsentModal} — see this file's own doc for what each drives. */
export type CookieConsentModalProps = {
  /**
   * The current request's own resolved `{lang}` segment (`[lang]/layout.tsx`'s own `data.lang`) —
   * threaded through to `buildConsentRequest` so the Accept/Decline round trip always targets THIS
   * page's own `/{lang}/consent`, never a hardcoded or missing prefix `langPreHandler` would
   * otherwise 301-redirect away.
   */
  lang: string
  /**
   * Whether this request's own `Cookie` header already carries a RECORDED consent decision (Accept
   * OR Decline) — `[lang]/layout.tsx`'s own `loader` computes this server-side
   * (`hasCookieConsentDecision`, `utils/cookie-consent.ts`) so this modal's initial open/closed
   * state is correct from the very first byte the server sends, on every page, not just after
   * client hydration.
   */
  initialDecided: boolean
  /** This request's own CSP nonce (`[lang]/layout.tsx`'s own `loader`, `PageContext.cspNonce`) —
   * threaded straight through to `Modal`'s own `nonce` prop so its self-rendered positioning
   * `<style>` element survives `@zanix/space`'s zero-config nonce-based `style-src` from the very
   * first server-rendered byte, not just after client hydration. `undefined` when no nonce-based CSP
   * is in effect. */
  cspNonce?: string
}

/**
 * This project's own project-wide cookie-consent dialog — composed exactly ONCE, in the root
 * `[lang]/layout.tsx`, so it gates every page equally rather than being special-cased per
 * session-issuing flow. See that layout file's own doc for the full architectural reasoning
 * (why this project diverges from `@zanix/console`'s own per-login-form
 * `cookie-consent-modal.comet.tsx`, which this component is grounded in but not a carbon copy of).
 *
 * Built entirely from `@zanix/space-ui`'s already-real `Modal`/`Button` — no new `space-ui`
 * component. `Modal`'s own backdrop (`showOverlay`, the default) covers the full viewport above
 * everything else while `open`, which is what actually prevents an operator from reaching, say,
 * the OAuth2 "Continue with Google" button underneath before deciding — no per-form submit
 * interception needed the way a single-entry-point app would use instead.
 *
 * Decline is deliberately persisted as a real, distinct cookie value (`accepted: false`, not just
 * "no cookie at all") — see `../routes/[lang]/consent/page.tsx`'s own doc. Re-prompting on
 * every single page navigation, which a per-visit-only "undecided" state would produce for a
 * project-wide gate like this one, would be real, unnecessary friction `@zanix/console`'s own
 * narrower, single-page gate never had to consider.
 */
export function CookieConsentModal(
  { lang, initialDecided, cspNonce }: CookieConsentModalProps,
): ReactElement | null {
  const [open, setOpen] = useState(!initialDecided)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)

  function decide(accepted: boolean) {
    setPending(true)
    setError(false)
    const { url, init } = buildConsentRequest(lang, accepted)

    fetch(url, init)
      .then((response) => {
        if (!response.ok) throw new Error(`Unexpected consent response status: ${response.status}`)
        setOpen(false)
      })
      .catch(() => {
        // A real network-level (or server) failure — this project's own session-issuing pages don't
        // depend on this round trip completing to function at all: an undecided/failed request just
        // means `@zanix/auth`'s own `checkAcceptedCookies` keeps resolving `false`, so no session
        // cookie is ever emitted — a fail-safe outcome, not a broken one. Surface the error and let
        // the operator retry, rather than silently closing the dialog as if the decision had been
        // recorded when it wasn't.
        setError(true)
      })
      .finally(() => setPending(false))
  }

  return (
    <Modal
      open={open}
      onClose={() => decide(false)}
      label='Cookie consent'
      closeOnEscape
      className={DIALOG_CLASS_NAME}
      nonce={cspNonce}
    >
      <h2>Session cookie</h2>
      <p>
        This service needs to store one cookie in your browser — the session cookie itself — to keep
        you signed in between pages. There is only this one cookie anywhere in this project right
        now; nothing else is tracked.
      </p>
      {error && <p role='alert'>Something went wrong recording your choice. Please try again.</p>}
      <Button onClick={() => decide(true)} disabled={pending}>Accept</Button>
      <Button onClick={() => decide(false)} disabled={pending}>Decline</Button>
    </Modal>
  )
}

/** This comet's client-hydration boundary — see `defineComet`'s own doc (`@zanix/space/comet`) for
 * what wraps {@linkcode CookieConsentModal} here. */
const cookieConsentModalComet: ReturnType<typeof defineComet<CookieConsentModalProps>> =
  defineComet(CookieConsentModal, import.meta.url)

export default cookieConsentModalComet
