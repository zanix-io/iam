import { createElement } from 'react'
import type { ReactElement } from 'react'
import type { CreateElement } from 'ui/typings/renderer.ts'
import RateLimitCountdown from 'ui/components/rate-limit-countdown/index.ts'
import { createRateLimitCard } from './render.ts'
import type { RateLimitCardProps } from './types.ts'

export type { RateLimitCardProps }

/**
 * `RateLimitCard` — see `render.ts`'s own doc for the full description. Plain presentational
 * component, NOT itself a Comet: it renders as ordinary server markup, composing the already-
 * `defineComet`-wrapped `RateLimitCountdown` (its DEFAULT export, the real hydration boundary)
 * as one of its children — no separate hydration story of its own is needed on top of that.
 *
 * React binding — import `./index.preact.ts` for the Preact one, same contract.
 */
export const RateLimitCard: (props: RateLimitCardProps) => ReactElement = createRateLimitCard(
  createElement as unknown as CreateElement<ReactElement>,
  {
    RateLimitCountdown: RateLimitCountdown as unknown as (
      props: Record<string, unknown>,
    ) => ReactElement,
  },
)
