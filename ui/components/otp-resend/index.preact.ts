'use comet'

import { h } from 'preact'
import type { VNode } from 'preact'
import { Button, Countdown } from '@zanix/space-ui/preact'
import { defineComet } from '@zanix/space/comet'
import type { CometBoundaryComponent, CometProps } from '@zanix/space/comet'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createOtpResend } from './render.ts'
import type { OtpResendProps } from './types.ts'

export type { OtpNotifierChannel, OtpResendProps } from './types.ts'

/**
 * An OTP resend + channel-picker Comet — see `index.ts`'s own doc for the full description.
 * Preact binding, same props, same rendered markup; import from `./index.ts` for the React one.
 */
// Same overload-set cast, and same factory-returned-name caveat, `index.ts`'s own React binding
// documents in full.
export const OtpResend: (props: OtpResendProps) => VNode = createOtpResend<VNode>(
  h as unknown as CreateElement<VNode>,
  {
    Button: Button as unknown as (props: Record<string, unknown>) => VNode,
    Countdown: Countdown as unknown as (props: Record<string, unknown>) => VNode,
  },
)

/** The `OtpResend` Comet — its own hydration boundary; mount this default export,
 * not the raw named component. */
export default defineComet(OtpResend, import.meta.url, 'OtpResend') as CometBoundaryComponent<
  OtpResendProps & CometProps
>
