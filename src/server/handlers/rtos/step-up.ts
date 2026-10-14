import { BaseRTO, IsString, Match } from '@zanix/validator'
import { STEP_UP_BIND_REGEX, STEP_UP_PURPOSE_REGEX } from 'utils/shared-enums.ts'

/** `POST /step-up/request` body — which action the second factor is for (see
 * `StepUpService.request`). */
export class StepUpRequestRTO extends BaseRTO {
  /** A short identifier of the action: 1 to 64 lowercase letters, digits and hyphens. */
  @Match(STEP_UP_PURPOSE_REGEX, { expose: true })
  accessor purpose!: string
}

/** `POST /step-up/verify` body — the second-factor `code` for `purpose`, and an optional `bind`
 * value the resulting token carries (see `StepUpService.verify`). */
export class StepUpVerifyRTO extends BaseRTO {
  /** The same identifier the code was requested for. */
  @Match(STEP_UP_PURPOSE_REGEX, { expose: true })
  accessor purpose!: string

  /** The authenticator-app code or the one-time code the user received. */
  @IsString({ expose: true })
  accessor code!: string

  /** An opaque value echoed into the token, such as the identifier of the pending action: 1 to
   * 256 printable ASCII characters. */
  @Match(STEP_UP_BIND_REGEX, { expose: true, optional: true })
  accessor bind: string | undefined
}
