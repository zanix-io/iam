import { h } from 'preact'
import type { VNode } from 'preact'
import { useIntl } from '@zanix/space-ui/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createTotpConfirmView } from './render.ts'
import type { TotpConfirmViewProps } from './types.ts'

export type { TotpConfirmViewProps }

/** `iam`'s TOTP-confirmation fallback view — see `index.ts`'s own doc. Preact binding, same
 * props, same rendered markup. */
export const TotpConfirmView: (props: TotpConfirmViewProps) => VNode = createTotpConfirmView(
  h as unknown as CreateElement<VNode>,
  { useIntl },
)
