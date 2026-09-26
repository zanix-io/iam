'use comet'

import { h } from 'preact'
import type { VNode } from 'preact'
import { useState } from 'preact/hooks'
import { Input } from '@zanix/space-ui/preact'
import { defineComet } from '@zanix/space/comet'
import type { CometBoundaryComponent, CometProps } from '@zanix/space/comet'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createOtpCodeField } from './render.ts'
import type { OtpCodeFieldProps } from './types.ts'

export type { OtpCodeFieldProps }

/**
 * The shared six-box OTP/verification-code field Comet — see `index.ts`'s own doc for the full
 * description. Preact binding, same props, same rendered markup; import from `./index.ts` for the
 * React one.
 */
// Same overload-set cast, and same factory-returned-name/no-slow-types caveats, `index.ts`'s own
// React binding documents in full.
export const OtpCodeField: (props: OtpCodeFieldProps) => VNode = createOtpCodeField<VNode>(
  h as unknown as CreateElement<VNode>,
  { useState },
  { Input: Input as unknown as (props: Record<string, unknown>) => VNode },
)

/** The `OtpCodeField` Comet — its own hydration boundary; mount this default export,
 * not the raw named component. */
export default defineComet(OtpCodeField, import.meta.url, 'OtpCodeField') as CometBoundaryComponent<
  OtpCodeFieldProps & CometProps
>
