import { assertEquals } from 'jsr:@std/assert@0.224'
import type { GuardContext } from '@zanix/server'

import {
  contextStepUpToken,
  STEP_UP_TOKEN_LOCALS_KEY,
  stepUpTokenGuard,
} from 'utils/step-up-token-guard.ts'
import { STEP_UP_TOKEN_HEADER } from 'utils/shared-enums.ts'

const context = (headers: Record<string, string>) =>
  ({ req: { headers: new Headers(headers) }, locals: {} }) as unknown as GuardContext

Deno.test('stepUpTokenGuard: records the header value in locals, trimmed, and lets the request through', () => {
  const ctx = context({ [STEP_UP_TOKEN_HEADER]: '  abc.def.ghi  ' })
  assertEquals(stepUpTokenGuard()(ctx), {})
  assertEquals(ctx.locals[STEP_UP_TOKEN_LOCALS_KEY], 'abc.def.ghi')
  assertEquals(contextStepUpToken(ctx), 'abc.def.ghi')
})

Deno.test('stepUpTokenGuard: no header, or an empty one, records nothing', () => {
  for (const headers of [{} as Record<string, string>, { [STEP_UP_TOKEN_HEADER]: '   ' }]) {
    const ctx = context(headers)
    stepUpTokenGuard()(ctx)
    assertEquals(contextStepUpToken(ctx), undefined)
  }
})

Deno.test('contextStepUpToken: ignores a non-string value and an absent locals', () => {
  assertEquals(contextStepUpToken({ locals: { [STEP_UP_TOKEN_LOCALS_KEY]: 42 } }), undefined)
  assertEquals(contextStepUpToken({}), undefined)
})

Deno.test('the step-up header is an X-Znx header', () => {
  assertEquals(STEP_UP_TOKEN_HEADER, 'X-Znx-Step-Up-Token')
})
