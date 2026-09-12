import type { CreateElement } from 'ui/typings/renderer.ts'
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
 * The `@zanix/space-ui` bindings this view needs, injected alongside `h`/hooks — `index.ts`/
 * `index.preact.ts` each supply their own renderer's real, already-bound copies (`@zanix/space-ui`'s
 * root barrel for React, `/preact` for Preact). Both `Modal` and `Button` are passed through `h`
 * as component REFERENCES below (`h(Modal, props, ...children)`), never called directly — `Modal`
 * calls real hooks internally (focus trap, open-stack bookkeeping); see {@linkcode CreateElement}'s
 * own doc for why that distinction is load-bearing, not stylistic.
 */
export type CookieConsentModalDeps<E> = {
  Modal: (props: {
    open: boolean
    onClose: () => void
    label: string
    closeOnEscape?: boolean
    className?: string
    nonce?: string
    children: Array<E | null>
  }) => E | null
  Button: (props: { onClick?: () => void; disabled?: boolean }) => E
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
 * Built entirely from the injected `Modal`/`Button` — no new `@zanix/space-ui` component needed.
 * `Modal`'s own backdrop (`showOverlay`, the default) covers the full viewport above everything
 * else while `open`, which is what actually prevents an operator from reaching, say, an OAuth2
 * "Continue with Google" button underneath before deciding.
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
  const { Modal, Button } = deps

  return function CookieConsentModal(
    { lang, initialDecided, cspNonce }: CookieConsentModalProps,
  ): E {
    const [open, setOpen] = hooks.useState(!initialDecided)
    const [pending, setPending] = hooks.useState(false)
    const [error, setError] = hooks.useState(false)

    function decide(accepted: boolean) {
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

    return h(
      Modal,
      {
        open,
        onClose: () => decide(false),
        label: 'Cookie consent',
        closeOnEscape: true,
        className: DIALOG_CLASS_NAME,
        nonce: cspNonce,
      },
      h('h2', { key: 'heading' }, 'Session cookie'),
      h(
        'p',
        { key: 'body' },
        'This service needs to store one cookie in your browser — the session cookie itself — ' +
          'to keep you signed in between pages. There is only this one cookie anywhere in this ' +
          'project right now; nothing else is tracked.',
      ),
      error
        ? h(
          'p',
          { key: 'error', role: 'alert' },
          'Something went wrong recording your choice. Please try again.',
        )
        : null,
      h(Button, { key: 'accept', onClick: () => decide(true), disabled: pending }, 'Accept'),
      h(Button, { key: 'decline', onClick: () => decide(false), disabled: pending }, 'Decline'),
    )
  }
}
