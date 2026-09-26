'use comet'

import { createElement, useState } from 'react'
import type { ReactElement } from 'react'
import { Input } from '@zanix/space-ui'
import { defineComet } from '@zanix/space/comet'
import type { CometBoundaryComponent, CometProps } from '@zanix/space/comet'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createOtpCodeField } from './render.ts'
import type { OtpCodeFieldProps } from './types.ts'

export type { OtpCodeFieldProps }

/**
 * The shared six-box OTP/verification-code field Comet — its own hydration boundary (the box
 * mirroring and auto-submit both need real client re-renders no native browser behavior gives for
 * free). See `render.ts`'s own doc for the full "why one real input, not six" account and why this
 * is a shared component, not private to any one page.
 *
 * React binding — import `./index.preact.ts` for the Preact one, same contract.
 * `OtpCodeField` (the raw, un-wrapped component) is exported here too — what `defineComet` reads
 * back on the client after a dynamic import, and also directly usable for a real-DOM interaction
 * test that needs no server/hydrate round trip.
 */
// Same overload-set cast `login/index.ts`'s own doc explains for every `@zanix/space-ui`
// component this project composes through `h`.
export const OtpCodeField: (props: OtpCodeFieldProps) => ReactElement = createOtpCodeField<
  ReactElement
>(
  createElement as unknown as CreateElement<ReactElement>,
  { useState },
  { Input: Input as unknown as (props: Record<string, unknown>) => ReactElement },
)

// `OtpCodeField` above is a factory-returned NAMED FUNCTION EXPRESSION (`render.ts`'s own inner
// `OtpCodeField`), not a top-level declaration — nothing protects its own `.name` from
// `zanix space build`'s default minification/`--obfuscate`, so the export name is passed
// explicitly here (see `defineComet`'s own doc). The `as CometBoundaryComponent<...>` clause is
// required since this file is part of `iam`'s own public `exports` — see
// `ui/components/password-toggle-field/index.ts`.
/** The `OtpCodeField` Comet — its own hydration boundary; mount this default export,
 * not the raw named component. */
export default defineComet(OtpCodeField, import.meta.url, 'OtpCodeField') as CometBoundaryComponent<
  OtpCodeFieldProps & CometProps
>
