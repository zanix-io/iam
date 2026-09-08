import { assert, assertEquals } from 'jsr:@std/assert@0.224'
import { mockHandlerContext } from '@zanix/space/testing'

import ConsentPage from 'space/routes/[lang]/consent/page.tsx'
import { mockActionContext } from '../../helpers/space-context.ts'

type ConsentParams = { lang: string }
type ConsentBody = { accepted: boolean }

Deno.test('ConsentPage.action: returns 204 with no body', async () => {
  const page = new ConsentPage(mockHandlerContext())
  const ctx = mockActionContext<ConsentParams, ConsentBody>({
    params: { lang: 'en' },
    body: { accepted: true },
  })
  const response = await page.action?.(ctx as never)
  assertEquals(response?.status, 204)
  assertEquals(await response?.text(), '')
})

Deno.test('ConsentPage.action: persists an acceptance as a real, matching Set-Cookie', async () => {
  const page = new ConsentPage(mockHandlerContext())
  const ctx = mockActionContext<ConsentParams, ConsentBody>({
    params: { lang: 'en' },
    body: { accepted: true },
  })
  const response = await page.action?.(ctx as never)
  const cookie = response?.headers.get('set-cookie')
  assert(cookie, 'Set-Cookie must be present')
  assertEquals(cookie.startsWith('X-Znx-Cookies-Accepted=true;'), true)
})

Deno.test('ConsentPage.action: a decline is persisted as a real, distinct =false cookie', async () => {
  const page = new ConsentPage(mockHandlerContext())
  const ctx = mockActionContext<ConsentParams, ConsentBody>({
    params: { lang: 'en' },
    body: { accepted: false },
  })
  const response = await page.action?.(ctx as never)
  const cookie = response?.headers.get('set-cookie')
  assert(cookie, 'Set-Cookie must be present even for a decline')
  assertEquals(cookie.startsWith('X-Znx-Cookies-Accepted=false;'), true)
})

Deno.test(
  'ConsentPage.action: the cookie carries HttpOnly/Secure/SameSite=Strict/Path=/',
  async () => {
    const page = new ConsentPage(mockHandlerContext())
    const ctx = mockActionContext<ConsentParams, ConsentBody>({
      params: { lang: 'en' },
      body: { accepted: true },
    })
    const response = await page.action?.(ctx as never)
    const cookie = response?.headers.get('set-cookie')
    assert(cookie)

    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) {
      assert(cookie.includes(attribute), `expected "${cookie}" to include "${attribute}"`)
    }
  },
)
