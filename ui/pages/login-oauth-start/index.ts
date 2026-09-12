import { createElement } from 'react'
import type { ReactElement } from 'react'
import { Button, useIntl } from '@zanix/space-ui'
// A NAMED import — `@zanix/space/comet/react` carries more than one ready-made Comet, so there is
// no single default.
import { SubmitGuard } from '@zanix/space/comet/react'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createOauthStartView } from './render.ts'
import type { OauthStartViewDeps } from './render.ts'
import type { OauthStartViewProps } from './types.ts'

export type { OauthStartViewProps }

/**
 * `iam`'s OAuth2 start-confirmation view — see `render.ts`'s own doc for the full description.
 * React binding — import from `@zanix/iam/ui/pages/login-oauth-start/preact` for the Preact one.
 */
// Same overload-set cast, and the same `SubmitGuard` cast, `pages/login/index.ts` uses for
// `ManagedForm` — see that file's own doc for the full reasoning (`CometBoundaryComponent`'s
// `SpaceChildren` return type isn't a structural match for a plain `(props) => E | null`).
export const OauthStartView: (props: OauthStartViewProps) => ReactElement = createOauthStartView(
  createElement as unknown as CreateElement<ReactElement>,
  {
    useIntl,
    Button,
    SubmitGuard: SubmitGuard as unknown as OauthStartViewDeps<ReactElement>['SubmitGuard'],
  },
)
