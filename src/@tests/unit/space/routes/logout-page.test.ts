import { assertEquals } from 'jsr:@std/assert@0.224'
import { mockHandlerContext } from '@zanix/space/testing'

import LogoutPage from 'space/routes/[lang]/logout/page.tsx'
import { fn, mockAccessor } from '../../helpers/mock.ts'
import { mockActionContext } from '../../helpers/space-context.ts'

type LogoutParams = { lang: string }

Deno.test('LogoutPage.action: revokes the session and redirects to login', async () => {
  const page = new LogoutPage(mockHandlerContext())
  const revokeToken = fn((..._args: unknown[]) => ({ response: 'token revoked' }))
  mockAccessor(page, 'interactor', { revokeToken })
  const ctx = mockActionContext<LogoutParams>({ params: { lang: 'en' } })
  const response = await page.action?.(ctx as never)
  assertEquals(response?.headers.get('location'), '/en/login')
  assertEquals(revokeToken.calls.length, 1)
  // Called with no explicit token — see this page's own doc for why `ctx.cookies` is the intended
  // fallback source, not something this page re-derives itself.
  assertEquals(revokeToken.calls[0], [])
})
