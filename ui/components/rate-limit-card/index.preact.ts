import { h } from 'preact'
import type { VNode } from 'preact'
import RateLimitCountdown from 'ui/components/rate-limit-countdown/index.preact.ts'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createRateLimitCard } from './render.ts'
import type { RateLimitCardProps } from './types.ts'

export type { RateLimitCardProps }

/**
 * `RateLimitCard` — see `render.ts`'s own doc for the full description. Preact binding, same
 * props, same rendered markup; import from `./index.ts` for the React one.
 */
export const RateLimitCard: (props: RateLimitCardProps) => VNode = createRateLimitCard(
  h as unknown as CreateElement<VNode>,
  {
    RateLimitCountdown: RateLimitCountdown as unknown as (
      props: Record<string, unknown>,
    ) => VNode,
  },
)
