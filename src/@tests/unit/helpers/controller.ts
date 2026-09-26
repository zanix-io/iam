import { assertEquals } from 'jsr:@std/assert@0.224'
import { mockAccessor } from './mock.ts'

/**
 * Table-driven check that each controller method forwards the right fields of its request payload
 * to the right interactor method, and returns the interactor's result unchanged. The controller is
 * instantiated directly (its constructor only needs a context id) with `interactor` shadowed by a
 * recorder, so no route, guard or DI container is involved: those are covered by
 * `integration/server/handlers/routes.test.ts`.
 */
export type DelegationCase = {
  /** Controller method under test. */
  method: string
  /** `ctx.payload` handed to it. */
  payload?: Record<string, unknown>
  /** Interactor method it must call. */
  calls: string
  /** Exact arguments that interactor method must receive. */
  args: unknown[]
}

export async function assertDelegates(
  // deno-lint-ignore no-explicit-any
  Controller: new (...args: any[]) => object,
  cases: DelegationCase[],
) {
  for (const { method, payload = {}, calls, args } of cases) {
    const received: unknown[][] = []
    const result = { from: calls }
    const controller = new Controller({ id: 'ctx-test' }) as Record<string, unknown>
    mockAccessor(controller, 'interactor', {
      [calls]: (...callArgs: unknown[]) => {
        received.push(callArgs)
        return result
      },
    })
    const handler = controller[method] as (ctx: unknown) => unknown
    // deno-lint-ignore no-await-in-loop
    const returned = await handler.call(controller, { payload })
    assertEquals(received, [args], `${Controller.name}.${method} -> interactor.${calls} arguments`)
    assertEquals(returned, result, `${Controller.name}.${method} returns the interactor result`)
  }
}
