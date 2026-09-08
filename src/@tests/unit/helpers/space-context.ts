import type { PageActionContext, PageContext } from '@zanix/space'
import { mockPageContext } from '@zanix/space/testing'

/**
 * `@zanix/space/testing` ships `mockPageContext` (for `loader`) but no `action`-shaped equivalent
 * yet (confirmed against its real `mod.ts` exports) — this project's own small extension, built
 * from `mockPageContext` itself rather than duplicating its defaults, for testing a page's own
 * `action` in isolation.
 *
 * @param overrides - Same shape `mockPageContext` accepts, plus `body` (the page's own already-
 * validated RTO instance, what a real `PageActionContext.body` carries).
 */
export function mockActionContext<Params = Record<string, string>, Body = unknown>(
  overrides: Partial<PageContext<Params>> & { body?: Body } = {},
): PageActionContext<Params, Body> {
  const { body, ...pageOverrides } = overrides
  return {
    ...mockPageContext<Params>(pageOverrides),
    formData: () => Promise.resolve(new FormData()),
    body,
    locals: {},
  }
}
