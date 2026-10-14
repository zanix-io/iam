import type Zanix from '@zanix/core'

/**
 * Key names `iam` handles that the default credential-key pattern of the logger does not match (it
 * matches exact key names), added on top of it. They name the step-up proof and the codes and
 * secrets of the second-factor flows, so none reaches a log line or an error response body:
 *
 * - `stepUpToken`, `x-znx-step-up-token`: the `factor-change` proof, in a body or as the header.
 * - `stepUpCode`: the confirmation code of the hosted forms.
 * - `pendingTotpSecret`, `totpSecret`: an authenticator secret.
 *
 * A bare `code` is deliberately not listed: the logger's pattern is also applied to error
 * responses, where `code` is the stable error code a client reads (`FACTOR_CHANGE_PROOF_REQUIRED`),
 * and redacting it would hide that. The one-time codes travel as `code` in a request body, which is
 * not logged.
 */
export const IAM_REDACTED_KEYS: readonly string[] = [
  'stepUpToken',
  'x-znx-step-up-token',
  'stepUpCode',
  'pendingTotpSecret',
  'totpSecret',
]

/** The `Zanix.setup()` options that register {@linkcode IAM_REDACTED_KEYS}. */
export const IAM_LOGGER_SETUP: NonNullable<Parameters<typeof Zanix.setup>[0]> = {
  logger: { redact: { extend: [...IAM_REDACTED_KEYS] } },
}
