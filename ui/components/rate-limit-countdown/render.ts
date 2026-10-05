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
 * its own, that effect never runs client-side, so the ring renders as a plain, static outline and
 * the remaining-time text never appears after the `login/rate-limited/body` lead-in. Wrapping
 * `Countdown`'s existing usage in a Comet (rather than reimplementing the tick) gives it that
 * boundary, with no change to `Countdown` itself.
 *
 * ## `onComplete` reaches OUTSIDE its own root, on purpose — real DOM, never Preact state
 *
 * The countdown reaching zero re-enables the form immediately, with NO page reload (see
 * `login/render.ts`'s own module doc) — but `LoginView` itself is plain, unhydrated content (same reason `Countdown`
 * needed this Comet in the first place), so there is no live Preact state this Comet's own
 * `onComplete` could flip that `LoginView`'s render would ever see — a Comet mounts as its own,
 * separate hydration root, with no inherited context or shared state across that boundary (see
 * `@zanix/space`'s own `defineComet` doc). Reaching `formId`'s real `<form>` element directly via
 * `document.getElementById` and clearing every `disabled` attribute inside it — a hydrated
 * Comet's own effect doing real, direct DOM work — is what makes "no page reload" achievable at all
 * given that constraint. `cardDataSpace` gets the same treatment (hidden outright) so the card
 * doesn't sit there forever showing a countdown stuck at `00:00`. `clearQueryParamsOnComplete`
 * (optional; see that prop's own doc) rounds this out with the one thing DOM surgery alone can't
 * reach — the browser's own address bar, which a reload/bookmark/shared link can resurrect this
 * whole rate-limited state from if a stale `retryUntil` is left sitting in it.
 *
 * ## Screen-reader announcement: localized through string props
 *
 * `Countdown` (`@zanix/space-ui` >= 2.9.4) announces through `announcementDone`,
 * `announcementLessThanMinute` and `announcementMinutes` (with a `{minutes}` marker), falling back
 * to English when one is missing. A Comet only receives serializable props, so those arrive
 * already resolved from the caller (`countdownAnnouncements` resolves them from `iam`'s catalog)
 * and are forwarded unchanged. The VISIBLE `format` (digits only, `Countdown`'s own default) needs
 * no translation.
 */
export function createRateLimitCountdown<E>(
  h: CreateElement<E>,
  { Countdown }: RateLimitCountdownDeps<E>,
): (props: RateLimitCountdownProps) => E {
  return function RateLimitCountdown(
    {
      target,
      size,
      strokeWidth,
      nonce,
      formId,
      cardDataSpace,
      clearQueryParamsOnComplete,
      announcementDone,
      announcementLessThanMinute,
      announcementMinutes,
    }: RateLimitCountdownProps,
  ): E {
    return h(Countdown, {
      target,
      variant: 'ring',
      size,
      strokeWidth,
      nonce,
      announcementDone,
      announcementLessThanMinute,
      announcementMinutes,
      onComplete: () => {
        const form = document.getElementById(formId)
        form?.querySelectorAll('[disabled]').forEach((el) => {
          ;(el as HTMLInputElement | HTMLButtonElement).disabled = false
        })
        document.querySelector(`[data-space='${cardDataSpace}']`)?.remove()

        if (clearQueryParamsOnComplete?.length) {
          const url = new URL(globalThis.location.href)
          let changed = false
          for (const param of clearQueryParamsOnComplete) {
            if (url.searchParams.has(param)) {
              url.searchParams.delete(param)
              changed = true
            }
          }
          if (changed) {
            globalThis.history.replaceState(globalThis.history.state, '', url)
          }
        }
      },
    })
  }
}
