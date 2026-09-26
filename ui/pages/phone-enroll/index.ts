import { createElement } from 'react'
import type { ReactElement } from 'react'
import { Button, Field, Input, useIntl } from '@zanix/space-ui'
// A NAMED import — see `login/index.ts`'s own identical doc. No draft persistence: this form
// fires once per real enrollment attempt.
import { SubmitGuard } from '@zanix/space/comet/react'
import { authHiddenFields } from 'ui/components/auth-hidden-fields/index.ts'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createPhoneEnrollView } from './render.ts'
import type { PhoneEnrollViewDeps } from './render.ts'
import type { PhoneEnrollViewProps } from './types.ts'

export type { PhoneEnrollViewProps }

/**
 * `iam`'s phone-verification enrollment view — a single phone-number field, submitting to this
 * same route's own `action`.
 *
 * React binding — import from `@zanix/iam/ui/pages/phone-enroll/preact` for the Preact one.
 */
export const PhoneEnrollView: (props: PhoneEnrollViewProps) => ReactElement = createPhoneEnrollView<
  ReactElement
>(
  createElement as unknown as CreateElement<ReactElement>,
  {
    useIntl,
    Button,
    Field,
    Input,
    SubmitGuard: SubmitGuard as unknown as PhoneEnrollViewDeps<ReactElement>['SubmitGuard'],
    authHiddenFields,
  },
)
