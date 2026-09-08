import { assertEquals, assertExists } from 'jsr:@std/assert@0.224'
import { mockPageContext } from '@zanix/space/testing'

import LangLayout, { loader } from 'space/routes/[lang]/layout.tsx'
import { COOKIE_CONSENT_ENABLED_ENV } from 'utils/constants.ts'

type LangParams = { lang: string }

Deno.test("LangLayout's own loader: forwards ctx.params.lang", () => {
  const ctx = mockPageContext<LangParams>({ params: { lang: 'fr' } })
  const data = loader(ctx)
  assertEquals(data.lang, 'fr')
})

Deno.test(
  "LangLayout's own loader: cookiesDecided is false with no consent cookie recorded",
  () => {
    const ctx = mockPageContext<LangParams>({
      params: { lang: 'fr' },
      request: new Request('http://localhost/fr/'),
    })
    assertEquals(loader(ctx).cookiesDecided, false)
  },
)

Deno.test(
  "LangLayout's own loader: cookiesDecided is true once a decision (accepted OR declined) is " +
    'recorded',
  () => {
    const acceptedCtx = mockPageContext<LangParams>({
      params: { lang: 'fr' },
      request: new Request('http://localhost/fr/', {
        headers: { cookie: 'X-Znx-Cookies-Accepted=true' },
      }),
    })
    const declinedCtx = mockPageContext<LangParams>({
      params: { lang: 'fr' },
      request: new Request('http://localhost/fr/', {
        headers: { cookie: 'X-Znx-Cookies-Accepted=false' },
      }),
    })
    assertEquals(loader(acceptedCtx).cookiesDecided, true)
    assertEquals(loader(declinedCtx).cookiesDecided, true)
  },
)

Deno.test("LangLayout's own loader: forwards ctx.cspNonce", () => {
  // `mockPageContext` doesn't forward `cspNonce` from its own overrides (a real, confirmed gap in
  // `@zanix/space/testing` — filed via `zanix report-issue`) — built here directly instead of
  // through that helper for this one field.
  const ctx = { ...mockPageContext<LangParams>({ params: { lang: 'fr' } }), cspNonce: 'abc123' }
  assertEquals(loader(ctx).cspNonce, 'abc123')
})

Deno.test('LangLayout: renders <html lang> from its own loader data', () => {
  const element = LangLayout({
    children: 'content',
    data: { lang: 'fr', cookiesDecided: true, cspNonce: undefined },
    params: { lang: 'fr' },
  })
  assertEquals(element.props.lang, 'fr')
})

/** The `<body>` element's own `children` array — `[modalSlot, pageChildren]`, see `LangLayout`'s
 * own JSX. Restores whatever `COOKIE_CONSENT_ENABLED_ENV` was set to beforehand, same pattern
 * `login-page.test.ts` already uses for its own env-var-gated `loader` tests. */
function bodyChildrenWithConsentEnv(value: string | undefined) {
  const original = Deno.env.get(COOKIE_CONSENT_ENABLED_ENV)
  if (value === undefined) Deno.env.delete(COOKIE_CONSENT_ENABLED_ENV)
  else Deno.env.set(COOKIE_CONSENT_ENABLED_ENV, value)
  try {
    const element = LangLayout({
      children: 'content',
      data: { lang: 'fr', cookiesDecided: true, cspNonce: undefined },
      params: { lang: 'fr' },
    })
    const [, body] = element.props.children
    return body.props.children as unknown[]
  } finally {
    if (original === undefined) Deno.env.delete(COOKIE_CONSENT_ENABLED_ENV)
    else Deno.env.set(COOKIE_CONSENT_ENABLED_ENV, original)
  }
}

Deno.test('LangLayout: mounts CookieConsentModal by default (COOKIE_CONSENT_ENABLED unset)', () => {
  const [modalSlot] = bodyChildrenWithConsentEnv(undefined)
  assertExists(modalSlot)
})

Deno.test("LangLayout: does not mount CookieConsentModal when it's explicitly disabled", () => {
  const [modalSlot] = bodyChildrenWithConsentEnv('false')
  assertEquals(modalSlot, false)
})
