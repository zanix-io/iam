'use comet'

import { createElement } from 'react'
import type { ReactElement } from 'react'
import { PasswordInput } from '@zanix/space-ui'
import { defineComet } from '@zanix/space/comet'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createPasswordToggleField } from './render.ts'
import type { PasswordToggleFieldProps } from './types.ts'

export type { PasswordToggleFieldProps }

/**
 * The login page's password visibility-toggle Comet — its own hydration boundary, separate from
 * `ManagedForm` (a sibling of the `<form>`, not a wrapper around any of its fields — see
 * `login/render.ts`'s own doc for why nothing inside the form hydrates through it). See
 * `render.ts`'s own doc for the full "why this needed its own Comet" account and the
 * `getToggleLabel` → `showLabel`/`hideLabel` adaptation.
 *
 * React binding — import `./index.preact.ts` for the Preact one, same contract.
 * `PasswordToggleField` (the raw, un-wrapped component) is exported here too — what `defineComet`
 * reads back on the client after a dynamic import, and also directly usable for a real-DOM
 * interaction test that needs no server/hydrate round trip.
 */
// Same overload-set cast `login/index.ts`'s own doc explains for every `@zanix/space-ui`
// component this project composes through `h`.
export const PasswordToggleField: (props: PasswordToggleFieldProps) => ReactElement =
  createPasswordToggleField<ReactElement>(
    createElement as unknown as CreateElement<ReactElement>,
    {
      PasswordInput: PasswordInput as unknown as (props: Record<string, unknown>) => ReactElement,
    },
  )

// `PasswordToggleField` above is a factory-returned NAMED FUNCTION EXPRESSION (`render.ts`'s own
// inner `PasswordToggleField`), not a top-level declaration — nothing protects its own `.name`
// from `zanix space build`'s default minification/`--obfuscate`, so the export name is passed
// explicitly here (the same gotcha, and fix, `@zanix/space-ui`'s own `NavDrawer` already
// establishes — see `defineComet`'s own doc, "A factory-returned named function expression needs
// the name passed explicitly").
export default defineComet(PasswordToggleField, import.meta.url, 'PasswordToggleField')
