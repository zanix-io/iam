import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'
import { mockHandlerContext } from '@zanix/space/testing'

import TotpConfirmPage from 'space/routes/[lang]/totp/confirm/page.tsx'
import { fn, mockAccessor } from '../../helpers/mock.ts'
import { mockActionContext } from '../../helpers/space-context.ts'

type ConfirmParams = { lang: string }

function pageWithInteractor(totpConfirm: (...args: unknown[]) => unknown) {
  const page = new TotpConfirmPage(mockHandlerContext())
  mockAccessor(page, 'interactor', { totpConfirm: fn(totpConfirm) })
  return page
}

Deno.test('TotpConfirmPage.redirect: sends every GET home, unconditionally', () => {
  assertEquals(TotpConfirmPage.redirect?.to, '/')
  assertEquals(TotpConfirmPage.redirect?.code, 302)
  // No `condition` at all — `pageSessionGuard([])` already guarantees anyone reaching this page's
  // `GET` is authenticated, unlike `LoginPage.redirect`, which still needs one of its own.
  assertEquals(TotpConfirmPage.redirect?.condition, undefined)
})

Deno.test('TotpConfirmPage.action: redirects home once the enrollment confirms', async () => {
  const page = pageWithInteractor(() => ({ response: 'TOTP enabled' }))
  const ctx = mockActionContext<ConfirmParams, { secret: string; code: string }>({
    params: { lang: 'en' },
    body: { secret: 'SECRET123', code: '123456' },
  })
  const response = await page.action?.(ctx as never)
  assertEquals(response?.headers.get('location'), '/')
})

Deno.test('TotpConfirmPage.action: PRGs back to enrollment with an error flag on a bad code', async () => {
  const page = pageWithInteractor(() => {
    throw new HttpError('FORBIDDEN', { message: 'Invalid TOTP code.' })
  })
  const ctx = mockActionContext<ConfirmParams, { secret: string; code: string }>({
    params: { lang: 'en' },
    body: { secret: 'SECRET123', code: 'bad' },
  })
  const response = await page.action?.(ctx as never)
  assertEquals(response?.headers.get('location'), '/en/totp/enroll?error=invalid_code')
})

Deno.test('TotpConfirmPage.action: a real server-side fault propagates unchanged', async () => {
  const page = pageWithInteractor(() => {
    throw new HttpError('INTERNAL_SERVER_ERROR', { message: 'Notifier is unreachable.' })
  })
  const ctx = mockActionContext<ConfirmParams, { secret: string; code: string }>({
    params: { lang: 'en' },
    body: { secret: 'SECRET123', code: '123456' },
  })
  await assertRejects(() => page.action?.(ctx as never) as Promise<Response>)
})
