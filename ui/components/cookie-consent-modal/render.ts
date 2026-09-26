import type { CreateElement } from 'ui/typings/renderer.ts'
import type { ConsentModalProps, Formatter } from '@zanix/space-ui'
import type { CookieConsentModalProps } from './types.ts'

import { buildConsentRequest } from 'utils/cookie-consent.ts'

/** The real, literal (never CSS-Module-hashed) class name `cookie-consent-modal.css` declares —
 * see this component's own doc for why that stylesheet is a plain CSS file wired through
 * `defineSpaceApp({ globalCss })` in `iam` itself, rather than a `*.module.css` import here. */
const DIALOG_CLASS_NAME = 'cookie-consent-dialog'

/**
 * The subset of `useState` this component's shared body needs, injected alongside `h` — the same
 * `render.ts`-factory technique `@zanix/space-ui`'s own `Table/render.ts` uses to inject
 * `useState` (see that file's own `TableHooks` doc for why sharing a hook this way across React's
 * and Preact's own dispatchers is sound: both key a hook's state on ITS OWN component instance's
 * call order, never on how the function that calls it was constructed).
 */
export type CookieConsentModalHooks = {
  useState: <T>(initial: T) => [T, (value: T) => void]
}

/**
 * The `@zanix/space-ui` binding this view needs, injected alongside `h`/hooks — `index.ts`/
 * `index.preact.ts` each supply their own renderer's real, already-bound `ConsentModal` (`@zanix/
 * space-ui`'s root export for React, `/preact` for Preact). Composed as-is — `iam`'s own dialog
 * copy and Accept/Decline/error wiring are the only project-specific pieces left here.
 */
export type CookieConsentModalDeps<E> = {
  ConsentModal: (props: ConsentModalProps) => E | null
  useIntl: () => Formatter
}

/**
 * The real implementation of `iam`'s project-wide cookie-consent dialog, shared identically
 * between the React and Preact bindings (`index.ts`/`index.preact.ts`) — parametrized by `h`,
 * {@linkcode CookieConsentModalHooks}, and {@linkcode CookieConsentModalDeps}. This file never
 * imports React, Preact, or `@zanix/space-ui` itself, and never imports `@zanix/space` either —
 * the Comet boundary itself (`'use comet'`, `defineComet`, `import.meta.url`) stays entirely in
 * `iam`'s own `space/comets/cookie-consent-modal.comet.tsx`, which wraps whichever binding of this
 * component `iam` itself renders with.
 *
 * Built entirely from the injected `ConsentModal` (`@zanix/space-ui`'s generic accept/decline
 * dialog) — no project-specific markup left in this file, only the copy and the decision logic.
 *
 * Decline is persisted the same way Accept is — a real, distinct recorded decision (never "no
 * cookie at all") — so a visitor who already declined isn't re-prompted on every single page
 * navigation. See `iam`'s own `consent/page.tsx` for where that decision is actually persisted.
 */
export function createCookieConsentModal<E>(
  h: CreateElement<E>,
  hooks: CookieConsentModalHooks,
  deps: CookieConsentModalDeps<E>,
): (props: CookieConsentModalProps) => E {
  const { ConsentModal, useIntl } = deps

  return function CookieConsentModal(
    { lang, initialDecided, cspNonce }: CookieConsentModalProps,
  ): E {
    const { formatMessage } = useIntl()
    const [open, setOpen] = hooks.useState(!initialDecided)
    const [pending, setPending] = hooks.useState(false)
    const [error, setError] = hooks.useState(false)

    function decide(accepted: boolean) {
      // `ConsentModal` exposes no per-button disabled state, unlike the plain `Button`s this
      // component used to compose directly — this guard reproduces the same double-submit
      // protection (a second click while the first request is still in flight is a no-op) without
      // needing one.
      if (pending) return
      setPending(true)
      setError(false)
      const { url, init } = buildConsentRequest(lang, accepted)

      fetch(url, init)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Unexpected consent response status: ${response.status}`)
          }
          setOpen(false)
        })
        .catch(() => {
          // A real network-level (or server) failure — this project's own session-issuing pages
          // don't depend on this round trip completing to function at all: an undecided/failed
          // request just means `@zanix/auth`'s own `checkAcceptedCookies` keeps resolving `false`,
          // so no session cookie is ever emitted — a fail-safe outcome, not a broken one. Surface
          // the error and let the operator retry, rather than silently closing the dialog as if
          // the decision had been recorded when it wasn't.
          setError(true)
        })
        .finally(() => setPending(false))
    }

    return h(ConsentModal, {
      open,
      onClose: () => decide(false),
      heading: formatMessage('cookie-consent-modal/heading'),
      body: formatMessage('cookie-consent-modal/body'),
      onAccept: () => decide(true),
      onDecline: () => decide(false),
      // `ConsentModal`'s own `acceptLabel`/`declineLabel` default to English literals — this
      // package has no i18n mechanism of its own (see `@zanix/space-ui`'s own `DatePicker/index.ts`
      // "locale is a plain, explicit prop" doc) — so every localized surface always passes both
      // explicitly, never relies on that default.
      acceptLabel: formatMessage('cookie-consent-modal/accept'),
      declineLabel: formatMessage('cookie-consent-modal/decline'),
      error: error ? formatMessage('cookie-consent-modal/error') : undefined,
      closeOnEscape: true,
      className: DIALOG_CLASS_NAME,
      nonce: cspNonce,
    })
  }
}
