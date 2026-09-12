'use comet'

import { h } from 'preact'
import type { VNode } from 'preact'
import { Countdown } from '@zanix/space-ui/preact'
import { defineComet } from '@zanix/space/comet'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createRateLimitCountdown } from './render.ts'
import type { RateLimitCountdownProps } from './types.ts'

export type { RateLimitCountdownProps }

/**
 * The login page's rate-limit countdown Comet — see `index.ts`'s own doc for the full
 * description. Preact binding, same props, same rendered markup; import from `./index.ts` for the
 * React one.
 */
// Same overload-set cast, and same factory-returned-name caveat, `index.ts`'s own React binding
// documents in full.
export const RateLimitCountdown: (props: RateLimitCountdownProps) => VNode =
  createRateLimitCountdown<VNode>(
    h as unknown as CreateElement<VNode>,
    { Countdown: Countdown as unknown as (props: Record<string, unknown>) => VNode },
  )

export default defineComet(RateLimitCountdown, import.meta.url, 'RateLimitCountdown')
