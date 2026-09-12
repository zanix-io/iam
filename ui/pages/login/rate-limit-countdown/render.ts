import type { CreateElement } from 'ui/typings/renderer.ts'
import type { RateLimitCountdownProps } from './types.ts'

/** The renderer's own already-built `Countdown` (`@zanix/space-ui` for React, `@zanix/space-ui/
 * preact` for Preact) this Comet wraps unmodified, injected the same way `login/render.ts`'s own
 * `LoginViewDeps` injects every `@zanix/space-ui` component it uses — `index.ts`/`index.preact.ts`
 * each supply their own renderer's real copy. */
export type RateLimitCountdownDeps<E> = {
  Countdown: (props: Record<string, unknown>) => E
}

/**
 * The real, renderer-neutral implementation `index.ts`/`index.preact.ts` each wrap in
 * `defineComet` — composes the unmodified `Countdown` (`@zanix/space-ui`), the same
 * "composed, not reimplemented" rule `password-toggle-field/render.ts`'s own doc already
 * establishes for `PasswordInput`; this file adds no ticking/formatting logic of its own, only a
 * Comet-safe prop shape plus the one real addition below.
 *
 * ## Why this needed its own Comet at all
 *
 * `login/render.ts` renders the whole rate-limit card as plain server HTML, outside any Comet
 * boundary — exactly the same gap `password-toggle-field/render.ts` already documents for the
 * password visibility toggle. `Countdown`'s own live wall-clock tick relies on a real mount
 * `useEffect` (`remainingMs` starts `null` and is only ever computed once that effect runs — see
 * `Countdown/render.ts`'s own "SSR / before the first tick" doc); with no hydration boundary of
 * its own, that effect never ran client-side at all, so the ring rendered as a plain, static
 * outline and the remaining-time text never appeared — confirmed live (`/login?error=rate_limited
 * &retryUntil=...`): an empty ring, "Podrás intentarlo de nuevo en:" with nothing after it,
 * forever. Wrapping `Countdown`'s existing usage in a Comet (rather than reimplementing the tick)
 * fixes exactly that, with no change to `Countdown` itself.
 *
 * ## `onComplete` reaches OUTSIDE its own root, on purpose — real DOM, never Preact state
 *
 * `login/render.ts`'s own module doc documents the ORIGINAL intent precisely: the countdown
 * reaching zero should re-enable the form "immediately with NO page reload." That's still exactly
 * what this does — but `LoginView` itself is plain, unhydrated content (same reason `Countdown`
 * needed this Comet in the first place), so there is no live Preact state this Comet's own
 * `onComplete` could flip that `LoginView`'s render would ever see — a Comet mounts as its own,
 * separate hydration root, with no inherited context or shared state across that boundary (see
 * `@zanix/space`'s own `defineComet` doc). Reaching `formId`'s real `<form>` element directly via
 * `document.getElementById` and clearing every `disabled` attribute inside it — the same "a
 * hydrated Comet's own effect doing real, direct DOM work" idiom this project's `Avatar` fix
 * already establishes for a different reason — is what makes "no page reload" achievable at all
 * given that constraint. `cardDataSpace` gets the same treatment (hidden outright) so the card
 * doesn't sit there forever showing a countdown stuck at `00:00`.
 *
 * ## Localization scope, disclosed: the screen-reader announcement stays in English
 *
 * `Countdown`'s own `getAnnouncement` is a FUNCTION prop, which can't cross a Comet's own
 * JSON-only prop boundary — same constraint `password-toggle-field/render.ts`'s own
 * `getToggleLabel` doc already documents, but unlike that one-word `showLabel`/`hideLabel` swap,
 * `login/rate-limited/announcement`'s own ICU `plural` form isn't reducible to a couple of
 * pre-resolved strings without either giving this Comet its own `IntlProvider` (real `messages`/
 * `locale` threaded through as props) or hand-rolling plural logic here. Neither is done in this
 * pass — this Comet uses `Countdown`'s own built-in `defaultAnnouncement` ("X minutes remaining"/
 * "Less than a minute remaining"), unlocalized, rather than block the real, user-visible fix (the
 * ring and the digits, neither of which needs translation) on a separate i18n-plumbing decision.
 * The VISIBLE `format` (digits only, `Countdown`'s own default) is unaffected either way.
 */
export function createRateLimitCountdown<E>(
  h: CreateElement<E>,
  { Countdown }: RateLimitCountdownDeps<E>,
): (props: RateLimitCountdownProps) => E {
  return function RateLimitCountdown(
    { target, size, strokeWidth, nonce, formId, cardDataSpace }: RateLimitCountdownProps,
  ): E {
    return h(Countdown, {
      target,
      variant: 'ring',
      size,
      strokeWidth,
      nonce,
      onComplete: () => {
        const form = document.getElementById(formId)
        form?.querySelectorAll('[disabled]').forEach((el) => {
          ;(el as HTMLInputElement | HTMLButtonElement).disabled = false
        })
        document.querySelector(`[data-space='${cardDataSpace}']`)?.remove()
      },
    })
  }
}
