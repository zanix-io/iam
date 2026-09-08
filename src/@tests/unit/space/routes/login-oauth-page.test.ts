import { assertEquals, assertThrows } from 'jsr:@std/assert@0.224'
import { mockHandlerContext, mockPageContext } from '@zanix/space/testing'

import LoginOauthStartPage from 'space/routes/[lang]/login/[oauth]/page.tsx'
import { fn, mockAccessor } from '../../helpers/mock.ts'
import { mockActionContext } from '../../helpers/space-context.ts'

type OauthParams = { lang: string; oauth: string }

Deno.test('LoginOauthStartPage.loader: rejects an unknown provider as not-found', () => {
  const page = new LoginOauthStartPage(mockHandlerContext())
  const ctx = mockPageContext<OauthParams>({ params: { lang: 'en', oauth: 'facebook' } })
  assertThrows(() => page.loader?.(ctx))
})

Deno.test('LoginOauthStartPage.loader: passes a real, configured provider through', () => {
  const page = new LoginOauthStartPage(mockHandlerContext())
  const ctx = mockPageContext<OauthParams>({ params: { lang: 'en', oauth: 'google' } })
  const data = page.loader?.(ctx) as { oauth: string }
  assertEquals(data.oauth, 'google')
})

Deno.test('LoginOauthStartPage.action: redirects the browser to the resolved authorization URL', async () => {
  const page = new LoginOauthStartPage(mockHandlerContext())
  mockAccessor(page, 'interactor', {
    loginWithOauth: fn(() => ({
      url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x',
      state: 'state-123',
    })),
  })
  const ctx = mockActionContext<OauthParams>({ params: { lang: 'en', oauth: 'google' } })
  const response = await page.action?.(ctx as never)
  assertEquals(response?.status, 302)
  assertEquals(
    response?.headers.get('location'),
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=x',
  )
})
