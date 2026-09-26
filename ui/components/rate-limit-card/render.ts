import type { CreateElement } from 'ui/typings/renderer.ts'
import type { RateLimitCardProps } from './types.ts'

/** The renderer's own already-`defineComet`-wrapped `RateLimitCountdown` (its DEFAULT export —
 * the real hydration boundary, never the raw named component: this card renders as plain,
 * unhydrated page markup itself, so the countdown
 * it composes needs its own Comet boundary for the identical reason `rate-limit-countdown/
 * render.ts`'s own doc explains in full — a bare, un-hydrated `Countdown` never runs its live tick
 * at all). Injected the same way `login/render.ts`'s own `LoginViewDeps` injects it;
 * `index.ts`/`index.preact.ts` each supply their own renderer's real default import. */
export type RateLimitCardDeps<E> = {
  RateLimitCountdown: (props: Record<string, unknown>) => E
}

/**
 * The real, renderer-neutral "rate-limit card" — heading + body copy, then the live countdown —
 * shared by every place in this package (and any consumer app) that shows one, so its shape lives
 * in one implementation instead of being hand-assembled per caller.
 *
 * ## Shape
 *
 * `<div role="status">` holding a `data-space="login-rate-limit-heading"` `<p>`, a
 * `data-space="login-rate-limit-body"` `<p>`, and then the countdown — always AFTER both messages,
 * since the body copy (`login/rate-limited/body`, "You can try again in:") is the
 * lead-in sentence the countdown answers.
 *
 * ## `cardDataSpace` drives the root's own hook AND `RateLimitCountdown`'s own DOM lookup
 *
 * `RateLimitCountdown`'s own `onComplete` removes `document.querySelector('[data-space=
 * cardDataSpace]')` entirely once the wait ends (see its own doc) — this card's root `<div>` is
 * that exact element, so both messages disappear along with the countdown in one real DOM removal,
 * never left behind as stale copy once a resend/retry becomes available again.
 */
export function createRateLimitCard<E>(
  h: CreateElement<E>,
  { RateLimitCountdown }: RateLimitCardDeps<E>,
): (props: RateLimitCardProps) => E {
  return function RateLimitCard(
    { headingLabel, bodyLabel, ...countdownProps }: RateLimitCardProps,
  ): E {
    return h(
      'div',
      { 'data-space': countdownProps.cardDataSpace, role: 'status' },
      h('p', { 'data-space': 'login-rate-limit-heading' }, headingLabel),
      h('p', { 'data-space': 'login-rate-limit-body' }, bodyLabel),
      h(RateLimitCountdown, countdownProps),
    )
  }
}
