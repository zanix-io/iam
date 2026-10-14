import { BaseRTO, IsString, Match } from '@zanix/validator'
import { STEP_UP_BIND_REGEX, STEP_UP_PURPOSE_REGEX } from 'utils/shared-enums.ts'
import type { NOTIFIERS, STEP_UP_METHODS } from 'utils/shared-enums.ts'

/**
 * @module
 *
 * Request/response shapes for `iam`'s real `StepUpController` (`POST /step-up/request`,
 * `POST /step-up/verify`). Every request class mirrors `iam/src/server/handlers/rtos/step-up.ts`
 * field-for-field, kept in sync by hand for the same reason `rtos/login.ts` is (see
 * `rtos/common.ts`'s header doc).
 */

/** `POST /step-up/request` body — the action the second factor is for. */
export class StepUpRequestRTO extends BaseRTO {
  /** A short identifier of the action: 1 to 64 lowercase letters, digits and hyphens. */
  @Match(STEP_UP_PURPOSE_REGEX, { expose: true })
  accessor purpose!: string
}

/** `POST /step-up/verify` body — the second-factor code for `purpose`, and an optional `bind`. */
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

/** `POST /step-up/request`'s real response: which factor the user's own settings require. */
export interface StepUpRequestResult {
  /** `'totp'`: enter the authenticator-app code, nothing was sent. `'otp'`: a one-time code was
   * just sent through {@link channel}. */
  method: typeof STEP_UP_METHODS[number]
  /** The channel the one-time code was sent through; present only when `method` is `'otp'`. */
  channel?: typeof NOTIFIERS[number]
  /** Seconds the caller has to complete `verify`. */
  expiresInSeconds: number
}

/** `POST /step-up/verify`'s real response. */
export interface StepUpVerifyResult {
  /** The signed step-up token (see {@link StepUpTokenClaims}). */
  stepUpToken: string
  /** The token's `exp` claim: seconds since the Unix epoch (not milliseconds, and not a
   * duration). */
  expiresAt: number
}

/** The claims of a step-up token. A service verifies the signature with `iam`'s public key
 * (RS256), then checks `typ`, `aud`, `purpose`, `sub` and, when it sent one, `bind`. */
export interface StepUpTokenClaims {
  /** The account id that passed the second factor. */
  sub: string
  /** Always `'step-up'`. */
  typ: 'step-up'
  /** Always `'iam:step-up'`. */
  aud: 'iam:step-up'
  /** The action the second factor authorized. */
  purpose: string
  /** The `bind` value of the verify request; absent when none was sent. */
  bind?: string
  /** The second factor that was verified. */
  method: typeof STEP_UP_METHODS[number]
  /** Unique token id; a service that needs single use records it. */
  jti: string
  /** Issuer. */
  iss: string
  /** Issued at, in seconds since the Unix epoch. */
  iat: number
  /** Expiry, in seconds since the Unix epoch (five minutes after `iat`). */
  exp: number
}
