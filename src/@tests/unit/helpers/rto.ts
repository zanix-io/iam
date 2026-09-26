import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { classValidation } from '@zanix/validator'
import { HttpError } from '@zanix/errors'

/**
 * Runs `@zanix/validator`'s own `classValidation` (the same call the server's request-validation
 * pipe makes for a route's `Body`/`Params`/`Search` RTO) against a plain payload.
 */
// deno-lint-ignore no-explicit-any
export function validate<T>(RTO: new (data: any) => T, payload: Record<string, unknown>) {
  // deno-lint-ignore no-explicit-any
  return classValidation(RTO as any, payload) as Promise<T>
}

/** Asserts validation fails, and that exactly `fields` are the ones reported. */
export async function assertInvalid(
  // deno-lint-ignore no-explicit-any
  RTO: new (data: any) => unknown,
  payload: Record<string, unknown>,
  fields: string[],
) {
  const error = await assertRejects(() => validate(RTO, payload), HttpError)
  const properties = (error.cause as { properties?: Record<string, unknown> }).properties ?? {}
  assertEquals(Object.keys(properties).sort(), [...fields].sort())
}
