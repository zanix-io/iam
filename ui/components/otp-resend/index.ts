'use comet'

import { createElement } from 'react'
import type { ReactElement } from 'react'
import { Button, Countdown } from '@zanix/space-ui'
import { defineComet } from '@zanix/space/comet'
import type { CometBoundaryComponent, CometProps } from '@zanix/space/comet'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createOtpResend } from './render.ts'
import type { OtpResendProps } from './types.ts'

export type { OtpNotifierChannel, OtpResendProps } from './types.ts'

/**
 * An OTP resend + channel-picker Comet — its own hydration boundary, shared by every real
 * OTP-login screen (`iam`'s own generic `OtpView`, and any consumer app's own differently-styled
 * one) — see `render.ts`'s own doc for the full "why this needed its own Comet" account.
 *
 * React binding — import `./index.preact.ts` for the Preact one, same contract.
 * `OtpResend` (the raw, un-wrapped component) is exported here too — what `defineComet` reads
 * back on the client after a dynamic import, and also directly usable for a real-DOM interaction
 * test that needs no server/hydrate round trip.
 */
// Same overload-set cast `login/index.ts`'s own doc explains for every `@zanix/space-ui`
// component this project composes through `h`.
export const OtpResend: (props: OtpResendProps) => ReactElement = createOtpResend<ReactElement>(
  createElement as unknown as CreateElement<ReactElement>,
  {
    Button: Button as unknown as (props: Record<string, unknown>) => ReactElement,
    Countdown: Countdown as unknown as (props: Record<string, unknown>) => ReactElement,
  },
)

// `OtpResend` above is a factory-returned NAMED FUNCTION EXPRESSION (`render.ts`'s own inner
// `OtpResend`), not a top-level declaration — same `password-toggle-field/index.ts` constraint:
// the export name is passed explicitly here. The `as CometBoundaryComponent<...>` clause
// matches every other component in this package's own public `exports`.
/** The `OtpResend` Comet — its own hydration boundary; mount this default export,
 * not the raw named component. */
export default defineComet(OtpResend, import.meta.url, 'OtpResend') as CometBoundaryComponent<
  OtpResendProps & CometProps
>
