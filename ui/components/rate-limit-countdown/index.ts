'use comet'

import { createElement } from 'react'
import type { ReactElement } from 'react'
import { Countdown } from '@zanix/space-ui'
import { defineComet } from '@zanix/space/comet'
import type { CometBoundaryComponent, CometProps } from '@zanix/space/comet'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createRateLimitCountdown } from './render.ts'
import type { RateLimitCountdownProps } from './types.ts'

export type { RateLimitCountdownProps }

/**
 * A rate-limit countdown Comet — its own hydration boundary, separate from `ManagedForm`/
 * `PasswordToggleField` — shared by every real rate-limited form in `iam` (the `login` page's own
 * email/OTP step first) and by any consumer app's OWN small form that needs a live countdown for
 * its own `429` — see `render.ts`'s own doc for the full "why this needed its own Comet" account
 * and the `onComplete`/localization trade-offs.
 *
 * React binding — import `./index.preact.ts` for the Preact one, same contract.
 * `RateLimitCountdown` (the raw, un-wrapped component) is exported here too — what `defineComet`
 * reads back on the client after a dynamic import, and also directly usable for a real-DOM
 * interaction test that needs no server/hydrate round trip.
 */
// Same overload-set cast `login/index.ts`'s own doc explains for every `@zanix/space-ui`
// component this project composes through `h`.
export const RateLimitCountdown: (props: RateLimitCountdownProps) => ReactElement =
  createRateLimitCountdown<ReactElement>(
    createElement as unknown as CreateElement<ReactElement>,
    { Countdown: Countdown as unknown as (props: Record<string, unknown>) => ReactElement },
  )

// `RateLimitCountdown` above is a factory-returned NAMED FUNCTION EXPRESSION
// (`render.ts`'s own inner `RateLimitCountdown`), not a top-level declaration — same
// `password-toggle-field/index.ts` constraint: the export name is passed explicitly here.
/** The `RateLimitCountdown` Comet — its own hydration boundary; mount this default export,
 * not the raw named component. */
export default defineComet(
  RateLimitCountdown,
  import.meta.url,
  'RateLimitCountdown',
) as CometBoundaryComponent<RateLimitCountdownProps & CometProps>
