import type { GuardContext, GuardResponse } from '@zanix/server'

import { STEP_UP_TOKEN_HEADER } from './shared-enums.ts'

/** The `ctx.locals` key {@linkcode stepUpTokenGuard} writes and {@linkcode contextStepUpToken} reads. */
export const STEP_UP_TOKEN_LOCALS_KEY = 'stepUpToken'

/**
 * Records the step-up token the request carries in the {@linkcode STEP_UP_TOKEN_HEADER} header in
 * `ctx.locals`, where the interactors read it ({@linkcode contextStepUpToken}) to check the proof
 * of a factor or credential change. Place it on every route that changes one.
 */
export function stepUpTokenGuard(): (ctx: GuardContext) => GuardResponse {
  return (ctx) => {
    const token = ctx.req.headers.get(STEP_UP_TOKEN_HEADER)?.trim()
    if (token) ctx.locals[STEP_UP_TOKEN_LOCALS_KEY] = token
    return {}
  }
}

/** The step-up token {@linkcode stepUpTokenGuard} recorded for the request, if any. */
export function contextStepUpToken(
  context: { locals?: Record<string, unknown> },
): string | undefined {
  const token = context.locals?.[STEP_UP_TOKEN_LOCALS_KEY]
  return typeof token === 'string' ? token : undefined
}
