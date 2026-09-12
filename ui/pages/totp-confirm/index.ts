import { createElement } from 'react'
import type { ReactElement } from 'react'
import { useIntl } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createTotpConfirmView } from './render.ts'
import type { TotpConfirmViewProps } from './types.ts'

export type { TotpConfirmViewProps }

/**
 * `iam`'s TOTP-confirmation fallback view — see `render.ts`'s own doc. React binding — import
 * from `@zanix/iam/ui/pages/totp-confirm/preact` for the Preact one.
 */
export const TotpConfirmView: (props: TotpConfirmViewProps) => ReactElement = createTotpConfirmView(
  createElement as unknown as CreateElement<ReactElement>,
  { useIntl },
)
