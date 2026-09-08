import { assertEquals } from 'jsr:@std/assert@0.224'
import { mockHandlerContext, mockPageContext } from '@zanix/space/testing'

import PasswordRecoveryRequestPage from 'space/routes/[lang]/password/recovery/[email]/page.tsx'
import { fn, mockAccessor } from '../../helpers/mock.ts'

type RecoveryParams = { lang: string; email: string }

Deno.test('PasswordRecoveryRequestPage.loader: dispatches recovery and decodes the email param', async () => {
  const page = new PasswordRecoveryRequestPage(mockHandlerContext())
  const recovery = fn((..._args: unknown[]) => ({ response: 'notification sent' }))
  mockAccessor(page, 'interactor', { recovery })
  const ctx = mockPageContext<RecoveryParams>({
    params: { lang: 'en', email: 'jane%40example.com' },
  })
  const data = await page.loader?.(ctx) as { email: string; lang: string }
  assertEquals(data.email, 'jane@example.com')
  assertEquals(data.lang, 'en')
  assertEquals(recovery.calls[0], ['jane@example.com'])
})

Deno.test('PasswordRecoveryRequestPage.loader: a malformed percent-sequence email param falls back to the raw value', async () => {
  const page = new PasswordRecoveryRequestPage(mockHandlerContext())
  const recovery = fn((..._args: unknown[]) => ({ response: 'notification sent' }))
  mockAccessor(page, 'interactor', { recovery })
  const ctx = mockPageContext<RecoveryParams>({
    params: { lang: 'en', email: '%E0%A4%A' },
  })
  const data = await page.loader?.(ctx) as { email: string }
  assertEquals(data.email, '%E0%A4%A')
  assertEquals(recovery.calls[0], ['%E0%A4%A'])
})
