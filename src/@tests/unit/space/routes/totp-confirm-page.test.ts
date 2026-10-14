import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'
import { mockHandlerContext } from '@zanix/space/testing'

import TotpConfirmPage from 'space/routes/[lang]/totp/confirm/page.tsx'
import { fn, mockAccessor } from '../../helpers/mock.ts'
import { mockActionContext } from '../../helpers/space-context.ts'

type ConfirmParams = { lang: string }

function pageWithInteractor(totpConfirm: (...args: unknown[]) => unknown) {
  const page = new TotpConfirmPage(mockHandlerContext())
  const provideFactorChangeProof = fn((..._args: unknown[]) => Promise.resolve())
  const confirm = fn(totpConfirm)
  mockAccessor(page, 'interactor', { totpConfirm: confirm, provideFactorChangeProof })
  return Object.assign(page, { confirm, provideFactorChangeProof })
}

const BODY = { secret: 'SECRET123', code: '123456', stepUpCode: '654321' }

Deno.test('TotpConfirmPage.redirect: sends every GET home, unconditionally', () => {
  assertEquals(TotpConfirmPage.redirect?.to, '/')
  assertEquals(TotpConfirmPage.redirect?.code, 302)
  // No `condition` at all — `pageSessionGuard([])` already guarantees anyone reaching this page's
  // `GET` is authenticated, unlike `LoginPage.redirect`, which still needs one of its own.
  assertEquals(TotpConfirmPage.redirect?.condition, undefined)
})

Deno.test('TotpConfirmPage.action: redirects home once the enrollment confirms', async () => {
  const page = pageWithInteractor(() => ({ response: 'TOTP enabled' }))
  const ctx = mockActionContext<
    ConfirmParams,
    { secret: string; code: string; stepUpCode: string }
  >({
    params: { lang: 'en' },
    body: BODY,
  })
  const response = await page.action?.(ctx as never)
  assertEquals(response?.headers.get('location'), '/')
  // The confirmation code becomes the proof first, then the confirmation runs with the form's code.
  assertEquals(page.provideFactorChangeProof.calls, [['totp-confirm', '654321']])
  assertEquals(page.confirm.calls, [['123456', 'SECRET123']])
})

Deno.test('TotpConfirmPage.action: a rejected confirmation code PRGs back to enrollment and confirms nothing', async () => {
  const page = pageWithInteractor(() => ({ response: 'TOTP enabled' }))
  page.provideFactorChangeProof = fn(() => {
    throw new HttpError('FORBIDDEN', { message: 'Invalid or expired code.' })
  })
  mockAccessor(page, 'interactor', {
    totpConfirm: page.confirm,
    provideFactorChangeProof: page.provideFactorChangeProof,
  })
  const ctx = mockActionContext<
    ConfirmParams,
    { secret: string; code: string; stepUpCode: string }
  >({
    params: { lang: 'en' },
    body: BODY,
  })
  const response = await page.action?.(ctx as never)
  assertEquals(response?.headers.get('location'), '/en/totp/enroll?error=invalid_code')
  assertEquals(page.confirm.calls.length, 0)
})

Deno.test('TotpConfirmPage.action: PRGs back to enrollment with an error flag on a bad code', async () => {
  const page = pageWithInteractor(() => {
    throw new HttpError('FORBIDDEN', { message: 'Invalid TOTP code.' })
  })
  const ctx = mockActionContext<
    ConfirmParams,
    { secret: string; code: string; stepUpCode: string }
  >({
    params: { lang: 'en' },
    body: { ...BODY, code: 'bad' },
  })
  const response = await page.action?.(ctx as never)
  assertEquals(response?.headers.get('location'), '/en/totp/enroll?error=invalid_code')
})

Deno.test('TotpConfirmPage.action: a real server-side fault propagates unchanged', async () => {
  const page = pageWithInteractor(() => {
    throw new HttpError('INTERNAL_SERVER_ERROR', { message: 'Notifier is unreachable.' })
  })
  const ctx = mockActionContext<
    ConfirmParams,
    { secret: string; code: string; stepUpCode: string }
  >({
    params: { lang: 'en' },
    body: BODY,
  })
  await assertRejects(() => page.action?.(ctx as never) as Promise<Response>)
})
