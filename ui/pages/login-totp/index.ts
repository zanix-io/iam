import { createElement } from 'react'
import type { ReactElement } from 'react'
import { Button, Field, Input, useIntl } from '@zanix/space-ui'
// A NAMED import — see `login/index.ts`'s own identical doc. No draft persistence: same
// single-use-code reasoning as `login-otp/index.ts`.
import { SubmitGuard } from '@zanix/space/comet/react'
import { RateLimitCard } from 'ui/components/rate-limit-card/index.ts'
import { authHiddenFields } from 'ui/components/auth-hidden-fields/index.ts'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createTotpLoginView } from './render.ts'
import type { TotpViewDeps } from './render.ts'
import type { TotpViewProps } from './types.ts'

export type { TotpViewProps }

/**
 * `iam`'s TOTP second-factor LOGIN challenge view — a heading, the account being signed into, a
 * single authenticator-code field, and a link back to sign-in.
 *
 * React binding — import from `@zanix/iam/ui/pages/login-totp/preact` for the Preact one.
 */
export const TotpLoginView: (props: TotpViewProps) => ReactElement = createTotpLoginView<
  ReactElement
>(
  createElement as unknown as CreateElement<ReactElement>,
  {
    useIntl,
    Button,
    Field,
    Input,
    SubmitGuard: SubmitGuard as unknown as TotpViewDeps<ReactElement>['SubmitGuard'],
    RateLimitCard: RateLimitCard as unknown as TotpViewDeps<ReactElement>['RateLimitCard'],
    authHiddenFields,
  },
)
